import { locallyCancelable } from "../../client/usage/correctionEligibility.js";
import { adoptInvoiceCorrection } from "./invoice.js";
import { closureByStripeId } from "../accountClosure/helpers.js";
import { correctionOutcome } from "../../client/usage/correctionProofs.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { read } from "../usageDelivery/helpers.js";
import { parseUsageQuantity } from "../../client/usage/contracts.js";
import { input, operation, history, view, json } from "./helpers.js";
import { restore } from "./accounting.js";
import { operationDoc } from "./schema.js";
export const prepare = mutation({
  args: { inputJson: v.string() },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const original = await input(args.inputJson),
      { event, outbox, record } = await read(ctx, {
        scope: original.request.scope,
        eventId: original.request
          .eventId as import("../_generated/dataModel.js").Id<"usageEvents">,
      });
    const prior = await ctx.db
      .query("usageCorrections")
      .withIndex("by_key", (q) => q.eq("key", original.key))
      .unique();
    if (prior) {
      if (prior.inputJson !== original.inputJson)
        throw new Error("Usage correction replay conflict");
      return prior;
    }
    for (const account of [
      record.scope.stripeAccountId,
      record.scope.customerAccount,
    ])
      if (await closureByStripeId(ctx, account))
        throw new Error("Account closure prevents new usage correction");
    const quantity = parseUsageQuantity(
      original.request.quantity ?? record.quantity,
      record.binding.plan.unit.precision,
    );
    if (
      BigInt(quantity.scaledQuantity) > BigInt(record.scaledQuantity) ||
      quantity.scaledQuantity === "0"
    )
      throw new Error("Invalid usage correction quantity");
    const rows = await ctx.db
      .query("usageCorrections")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(101);
    if (rows.length >= 100)
      throw new Error("Retained event correction quota exhausted");
    const partial = quantity.scaledQuantity !== record.scaledQuantity;
    if (
      !partial &&
      rows.some(
        (row) =>
          row.scaledQuantity === record.scaledQuantity &&
          row.state !== "unsupported",
      )
    )
      throw new Error("Original usage already has a correction operation");
    const unsent = locallyCancelable(outbox);
    const prepaid = record.binding.plan.model === "prepaid";
    const state = partial
      ? ("unsupported" as const)
      : unsent && !prepaid
        ? ("confirmed" as const)
        : ("requested" as const);
    const reason = partial
      ? "partial_event_requires_replacement_or_invoice_adjustment"
      : state === "confirmed"
        ? outbox.state === "rejected"
          ? "canceled_after_delivery_rejection"
          : "canceled_before_delivery"
        : unsent
          ? "credit_backing_verification_required"
          : "native_cancellation_required";
    const id = await ctx.db.insert("usageCorrections", {
      stripeAccountId: record.scope.stripeAccountId,
      customerAccount: record.scope.customerAccount,
      key: original.key,
      scopeKey: original.scopeKey,
      eventId: event._id,
      correctionId: original.request.correctionId,
      inputJson: original.inputJson,
      recordJson: event.recordJson,
      subscriptionJson: event.subscriptionJson,
      quantity: quantity.quantity,
      scaledQuantity: quantity.scaledQuantity,
      state,
      reason,
      firstAttemptAt: Math.floor(Date.now() / 1000),
      attempt: 0,
      restoredQuantity: state === "confirmed" ? quantity.quantity : "0",
      historyCount: 0,
      cashConsequence: "none",
    });
    const row = (await ctx.db.get("usageCorrections", id))!;
    if (!partial) {
      await ctx.db.patch("usageOutbox", outbox._id, {
        held: true,
        correctionKey: row.key,
        ...(state === "confirmed"
          ? { state: "canceled" as const, reason: "usage_canceled" as const }
          : {}),
      });
      if (state === "confirmed") await restore(ctx, row, event);
    }
    await history(ctx, row, {
      request: original.request,
      providerIdentifier: outbox.providerIdentifier,
      originalReceipt: outbox.receipt ?? null,
      result: view(row),
    });
    return operation(ctx, row.key);
  },
});

export const claim = mutation({
  args: { key: v.string() },
  returns: v.object({
    kind: v.union(v.literal("ready"), v.literal("busy"), v.literal("done")),
    attempt: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await operation(ctx, args.key),
      now = Math.floor(Date.now() / 1000);
    if (
      [
        "confirmed",
        "unsupported",
        "provider_accepted",
        "invoice_adjustment_required",
      ].includes(row.state)
    )
      return { kind: "done" as const, attempt: row.attempt };
    if ((row.leaseUntil ?? 0) > now)
      return { kind: "busy" as const, attempt: row.attempt };
    const source = await read(ctx, {
      scope: JSON.parse(row.inputJson).scope,
      eventId: row.eventId,
    });
    const neverDelivered = locallyCancelable(source.outbox);
    if (
      !neverDelivered &&
      row.attemptedAt !== undefined &&
      now - row.attemptedAt >= 23 * 3600
    ) {
      await ctx.db.patch("usageCorrections", row._id, {
        state: "held",
        reason: "native_retry_window_expired",
        leaseUntil: 0,
      });
      await history(ctx, row, { safeRetryWindowExpired: true });
      return { kind: "done" as const, attempt: row.attempt };
    }
    const originalScope = JSON.parse(row.recordJson).scope;
    for (const account of [
      originalScope.stripeAccountId,
      originalScope.customerAccount,
    ])
      if (await closureByStripeId(ctx, account))
        throw new Error(
          "Account closure prevents correction provider operation",
        );
    const attempt = row.attempt + 1;
    await ctx.db.patch("usageCorrections", row._id, {
      attempt,
      attemptedAt: row.attemptedAt ?? now,
      leaseUntil: now + 900,
    });
    await history(ctx, row, { phase: "attempt", attempt });
    return { kind: "ready" as const, attempt };
  },
});
export const save = mutation({
  args: { key: v.string(), attempt: v.number(), outcomeJson: v.string() },
  returns: operationDoc,
  handler: async (ctx, args) => {
    const row = await operation(ctx, args.key);
    if (row.state === "confirmed") return row;
    if (row.attempt !== args.attempt || row.attemptedAt === undefined)
      throw new Error("Stale correction receipt");
    const result = correctionOutcome.parse(json(args.outcomeJson));
    const request = JSON.parse(row.inputJson),
      { event, outbox, record } = await read(ctx, {
        scope: request.scope,
        eventId: row.eventId,
      });
    if (outbox.correctionKey !== row.key)
      throw new Error("Correction outbox identity mismatch");
    if (result.status === "pending" || result.status === "complete") {
      if (
        !outbox.receipt ||
        outbox.receipt.identifier !== result.identifier ||
        result.identifier !== outbox.providerIdentifier ||
        result.eventName !== record.binding.eventName ||
        result.livemode !== record.scope.livemode
      )
        throw new Error("Native correction receipt scope mismatch");
      const confirm =
        result.status === "complete" &&
        result.billingSafe &&
        (record.binding.plan.model !== "prepaid" ||
          result.creditBackingVerified);
      await ctx.db.patch("usageCorrections", row._id, {
        state: confirm
          ? "confirmed"
          : result.status === "pending"
            ? "provider_accepted"
            : !result.billingSafe
              ? "invoice_adjustment_required"
              : "held",
        reason: confirm
          ? "native_cancellation_complete"
          : result.status === "pending"
            ? "native_cancellation_pending"
            : !result.billingSafe
              ? "native_invoice_finalized_or_unresolved"
              : "credit_backing_requires_reconciliation",
        invoiceId: result.invoiceId,
        cashConsequence:
          result.status === "complete" && !result.billingSafe
            ? "operator_resolution_required"
            : "none",
        nativeStatus: result.status,
        nativeAdjustmentId: result.nativeAdjustmentId ?? undefined,
        leaseUntil: 0,
        restoredQuantity: confirm ? row.quantity : "0",
      });
    } else if (result.status === "local_complete") {
      if (!locallyCancelable(outbox) || record.binding.plan.model !== "prepaid")
        throw new Error("Unsent credit correction provenance mismatch");
      await ctx.db.patch("usageCorrections", row._id, {
        state: "confirmed",
        reason:
          outbox.state === "rejected"
            ? "canceled_after_delivery_rejection"
            : "canceled_before_delivery",
        leaseUntil: 0,
        restoredQuantity: row.quantity,
      });
    } else if ("reason" in result) {
      await ctx.db.patch("usageCorrections", row._id, {
        state: result.status,
        reason: result.reason,
        invoiceId: result.invoiceId,
        leaseUntil: 0,
        cashConsequence:
          result.status === "invoice_adjustment_required"
            ? "operator_resolution_required"
            : "none",
      });
    }
    const saved = await operation(ctx, row.key);
    if (saved.state === "confirmed") {
      await restore(ctx, row, event);
      await ctx.db.patch("usageOutbox", outbox._id, {
        state: "canceled",
        held: true,
        reason: "usage_canceled",
      });
    }
    await history(ctx, saved, {
      attempt: args.attempt,
      providerIdentifier: outbox.providerIdentifier,
      outcome: result,
      result: view(saved),
    });
    return operation(ctx, row.key);
  },
});

export const adopt = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: operationDoc,
  handler: adoptInvoiceCorrection,
});
