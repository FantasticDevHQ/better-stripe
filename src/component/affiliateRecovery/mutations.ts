import { commissionExposureValidator } from "../settlement/clawbackSchema.js";
import { applyObligationExposure } from "../settlement/clawbacks.js";
import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { balance, updateObligation, due, credit } from "./accounting.js";
import { operationFields, recoveryState } from "./schema.js";
import { deriveReversalState } from "../lib/reversals.js";
const operationDoc = v.object({
  ...operationFields,
  _id: v.id("affiliateRecoveryOperations"),
  _creationTime: v.number(),
});
export const reserveOperation = mutation({
  args: {
    obligationId: v.id("affiliateObligations"),
    kind: v.union(v.literal("recovery"), v.literal("restoration")),
    now: v.number(),
  },
  returns: v.union(operationDoc, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("affiliateObligations", args.obligationId);
    if (!row) throw new Error("Affiliate obligation not found.");
    if (row.needsReconciliation) return null;
    if (
      (await balance(ctx, row.affiliateAccountId, row.currency))
        ?.activePayoutKey
    )
      throw new Error("Affiliate payout is pending reconciliation.");
    if (row.activeOperationId)
      return ctx.db.get("affiliateRecoveryOperations", row.activeOperationId);
    const originalTransfer = row.stripeTransferId
      ? await ctx.db
          .query("transfers")
          .withIndex("by_stripe_transfer_id", (q) =>
            q.eq("stripeTransferId", row.stripeTransferId!),
          )
          .unique()
      : null;
    const reversible = originalTransfer
      ? originalTransfer.amount - (originalTransfer.reversedAmount ?? 0)
      : 0;
    const amount =
      args.kind === "recovery"
        ? Math.min(due(row), Math.max(0, reversible))
        : credit(row);
    if (amount <= 0 || (args.kind === "recovery" && !row.stripeTransferId)) {
      if (args.kind === "recovery" && due(row) > 0)
        await updateObligation(ctx, row, {
          lastState: "offset_required",
          lastError:
            "Original transfer has no reversible funds; recover from eligible future commissions.",
        });
      return null;
    }
    const id = await ctx.db.insert("affiliateRecoveryOperations", {
      obligationId: row._id,
      sourceEventId:
        args.kind === "restoration"
          ? row.disputeId
          : (row.lastRefundId ?? row.disputeId),
      kind: args.kind,
      amount,
      state: "pending",
      attempted: false,
      providerBaseline: originalTransfer?.reversedAmount ?? 0,
      createdAt: args.now,
    });
    await updateObligation(ctx, row, {
      activeOperationId: id,
      [args.kind === "recovery" ? "reservedRecovery" : "reservedRestoration"]:
        amount,
      lastState: "pending",
      lastError: undefined,
    });
    return (await ctx.db.get("affiliateRecoveryOperations", id))!;
  },
});
/** Persist intent before contacting Stripe. Retries keep the exact operation ID. */
export const beginOperation = mutation({
  args: { operationId: v.id("affiliateRecoveryOperations") },
  returns: operationDoc,
  handler: async (ctx, { operationId }) => {
    const op = await ctx.db.get("affiliateRecoveryOperations", operationId);
    if (!op) throw new Error("Affiliate operation not found.");
    const row = (await ctx.db.get("affiliateObligations", op.obligationId))!;
    if (
      !op.attempted &&
      (op.kind === "recovery" ? due(row) : credit(row)) < op.amount
    ) {
      await ctx.db.patch("affiliateRecoveryOperations", op._id, {
        state: "canceled",
      });
      await updateObligation(ctx, row, {
        activeOperationId: undefined,
        reservedRecovery: 0,
        reservedRestoration: 0,
        lastState: "canceled",
      });
      return { ...op, state: "canceled" as const };
    }
    if (op.state === "pending" && !op.attempted)
      await ctx.db.patch("affiliateRecoveryOperations", op._id, {
        attempted: true,
      });
    return { ...op, attempted: true };
  },
});
export const completeOperation = mutation({
  args: {
    operationId: v.id("affiliateRecoveryOperations"),
    state: recoveryState,
    receiptId: v.optional(v.string()),
    confirmedTransferReversed: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await ctx.db.get(
      "affiliateRecoveryOperations",
      args.operationId,
    );
    if (!op) throw new Error("Affiliate operation not found.");
    if (op.state === "succeeded") {
      if (args.state === "succeeded" && op.receiptId !== args.receiptId)
        throw new Error("Affiliate receipt identity cannot change.");
      return null;
    }
    const row = (await ctx.db.get("affiliateObligations", op.obligationId))!;
    if (args.state === "succeeded" && !args.receiptId)
      throw new Error("Confirmed affiliate recovery requires a receipt.");
    const pending = args.state === "pending" || args.state === "unknown";
    const patch = {
      lastState: args.state,
      lastError: args.error,
      activeOperationId: pending ? op._id : undefined,
      reservedRecovery: op.kind === "recovery" && pending ? op.amount : 0,
      reservedRestoration: op.kind === "restoration" && pending ? op.amount : 0,
    };
    if (args.state === "succeeded") {
      if (op.kind === "recovery") {
        if (!row.stripeTransferId)
          throw new Error("Recovery has no original Connect transfer.");
        const transfer = await ctx.db
          .query("transfers")
          .withIndex("by_stripe_transfer_id", (q) =>
            q.eq("stripeTransferId", row.stripeTransferId!),
          )
          .unique();
        if (!transfer) throw new Error("Original transfer not found.");
        const total = row.recoveredAmount + op.amount;
        if (total > transfer.amount)
          throw new Error("Recovery exceeds original transfer.");
        const aggregate = args.confirmedTransferReversed;
        if (
          aggregate === undefined ||
          !Number.isSafeInteger(aggregate) ||
          aggregate < total ||
          aggregate > transfer.amount
        )
          throw new Error(
            "A confirmed provider transfer aggregate is required.",
          );
        await ctx.db.patch(
          "transfers",
          transfer._id,
          deriveReversalState(
            transfer.amount,
            Math.max(aggregate, transfer.reversedAmount ?? 0),
            transfer.status,
          ),
        );
        const duplicate = await ctx.db
          .query("affiliateReversalReceipts")
          .withIndex("by_receipt", (q) =>
            q.eq("stripeReversalId", args.receiptId!),
          )
          .unique();
        if (duplicate)
          throw new Error(
            "Affiliate reversal receipt has already been attributed.",
          );
        await ctx.db.insert("affiliateReversalReceipts", {
          stripeReversalId: args.receiptId!,
          stripeTransferId: row.stripeTransferId,
          operationId: op._id,
          amount: op.amount,
        });
        await updateObligation(ctx, row, { ...patch, recoveredAmount: total });
      } else {
        await ctx.db.insert("transfers", {
          stripeTransferId: args.receiptId!,
          sourceChargeId: row.sourceChargeId,
          sourceInvoiceId: row.sourceInvoiceId,
          destinationAccountId: row.affiliateAccountId,
          currency: row.currency,
          amount: op.amount,
          role: "affiliate",
          status: "paid",
          reinstatement: true,
          metadata: { bsRecoveryOperation: op._id },
        });
        await updateObligation(ctx, row, {
          ...patch,
          restoredAmount: (row.restoredAmount ?? 0) + op.amount,
        });
      }
    } else await updateObligation(ctx, row, patch);
    await ctx.db.patch("affiliateRecoveryOperations", op._id, {
      state: args.state,
      receiptId: args.receiptId,
      error: args.error,
    });
    return null;
  },
});

/** Trusted operator API; the client verifies provider facts before this write. */
export const reviewLegacy = mutation({
  args: {
    obligationId: v.id("affiliateObligations"),
    recoveredAmount: v.number(),
    restoredAmount: v.number(),
    receipts: v.array(v.object({ id: v.string(), amount: v.number() })),
    restorationIds: v.array(v.string()),
    note: v.string(),
    exposure: commissionExposureValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("affiliateObligations", args.obligationId);
    if (!row || !row.needsReconciliation || row.activeOperationId)
      throw new Error("Obligation is not eligible for legacy review.");
    if (
      !args.note.trim() ||
      args.receipts.length > 100 ||
      new Set(args.receipts.map((r) => r.id)).size !== args.receipts.length ||
      ![
        args.recoveredAmount,
        args.restoredAmount,
        ...args.receipts.map((r) => r.amount),
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      args.recoveredAmount > row.originalCommission ||
      args.restoredAmount > args.recoveredAmount ||
      args.receipts.reduce((n, r) => n + r.amount, 0) !== args.recoveredAmount
    )
      throw new Error("Legacy review does not reconcile.");
    await applyObligationExposure(ctx, row, args.exposure);
    const observed = (await ctx.db.get("affiliateObligations", row._id))!;
    for (const receipt of args.receipts) {
      const existing = await ctx.db
        .query("affiliateReversalReceipts")
        .withIndex("by_receipt", (q) => q.eq("stripeReversalId", receipt.id))
        .unique();
      if (existing && existing.stripeTransferId !== row.stripeTransferId)
        throw new Error("Legacy receipt belongs to another original transfer.");
      if (!existing)
        await ctx.db.insert("affiliateReversalReceipts", {
          stripeReversalId: receipt.id,
          stripeTransferId: row.stripeTransferId!,
          operationId: `review:${row._id}`,
          amount: receipt.amount,
        });
    }
    await updateObligation(ctx, observed, {
      recoveredAmount: args.recoveredAmount,
      restoredAmount: args.restoredAmount,
      needsReconciliation: false,
      legacyReceiptIds: args.receipts.map((r) => r.id),
      legacyRestorationIds: args.restorationIds,
      operatorNote: args.note,
      lastState: "reviewed",
    });
    return null;
  },
});
