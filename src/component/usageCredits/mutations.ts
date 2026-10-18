import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { accountTerms, grants } from "./helpers.js";
import {
  creditCost,
  type UsageCreditBinding,
} from "../../client/usage/creditTerms.js";
import { creditNativeObservation } from "../../client/usage/creditProofs.js";
import { normalizeCreditState } from "../../client/usage/creditObservation.js";
import { purchaseTerms } from "./helpers.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { scopeValidator } from "../usage/schema.js";
import { purchaseDoc } from "./schema.js";
import * as purchases from "./purchase.js";
import * as reservations from "./reservations.js";
import { boundedJson, purchase, account, history } from "./helpers.js";
export const preparePurchase = mutation({
  args: { inputJson: v.string() },
  returns: purchaseDoc,
  handler: (ctx, args) => purchases.preparePurchase(ctx, args.inputJson),
});
export const pinPayment = mutation({
  args: { key: v.string(), paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await purchases.pinPayment(ctx, args.key, args.paymentIntentId);
    return null;
  },
});
export const verifyPayment = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    boundedJson(args.proofJson);
    await purchases.verifyPayment(ctx, args.key, args.proofJson);
    return null;
  },
});
export const pinGrant = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    boundedJson(args.proofJson);
    await purchases.pinGrant(ctx, args.key, args.proofJson);
    return null;
  },
});
export const reserve = mutation({
  args: { inputJson: v.string(), subscriptionJson: v.string() },
  returns: v.object({
    reservationId: v.id("usageReservations"),
    state: v.union(
      v.literal("reserved"),
      v.literal("committed"),
      v.literal("released"),
    ),
  }),
  handler: (ctx, args) =>
    reservations.reserve(ctx, args.inputJson, args.subscriptionJson),
});
export const release = mutation({
  args: {
    scope: scopeValidator,
    reservationId: v.id("usageReservations"),
    reason: v.union(
      v.literal("work_failed"),
      v.literal("abandoned_before_work"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await reservations.release(
      ctx,
      args.scope,
      args.reservationId,
      args.reason,
    );
    return null;
  },
});

export const freezePurchase = mutation({
  args: {
    key: v.string(),
    paymentIntentId: v.string(),
    refundedAmount: v.optional(v.number()),
    reason: v.union(
      v.literal("payment_refunded"),
      v.literal("payment_disputed"),
      v.literal("native_state_changed"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await purchase(ctx, args.key);
    if (row.paymentIntentId !== args.paymentIntentId)
      throw new Error("Credit recovery payment identity mismatch");
    const grant = await ctx.db
      .query("usageCreditGrants")
      .withIndex("by_purchase", (q) => q.eq("purchaseKey", row.key))
      .unique();
    const terms = (await purchaseTerms(row.termsJson)).terms;
    if (
      args.refundedAmount !== undefined &&
      (!Number.isSafeInteger(args.refundedAmount) ||
        args.refundedAmount < 0 ||
        args.refundedAmount > terms.amount)
    )
      throw new Error("Invalid original credit refund amount");
    await ctx.db.patch("usageCreditPurchases", row._id, {
      state: "frozen",
      refundedAmount: Math.max(
        row.refundedAmount ?? 0,
        args.refundedAmount ?? 0,
      ),
    });
    if (grant)
      await ctx.db.patch("usageCreditGrants", grant._id, { frozen: true });
    if (grant && (BigInt(grant.reserved) > 0n || BigInt(grant.consumed) > 0n)) {
      const ledger = await account(ctx, row.accountKey);
      await ctx.db.patch("usageCreditAccounts", ledger._id, {
        frozenReason: args.reason,
      });
    }
    await history(
      ctx,
      row.accountKey,
      "recovery",
      args.paymentIntentId,
      {
        reason: args.reason,
        creditGrantId: row.creditGrantId ?? null,
        cashCollection: "none",
        refundedAmount: args.refundedAmount ?? null,
      },
      row.key,
    );
    return null;
  },
});

export const saveObservation = mutation({
  args: { inputJson: v.string(), proofJson: v.string(), startedAt: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.startedAt) ||
      args.startedAt < 0 ||
      args.startedAt > Date.now() + 300000
    )
      throw new Error("Invalid credit observation time");
    const parsed = await purchaseTerms(args.inputJson),
      row = await purchase(ctx, parsed.key);
    const proof = creditNativeObservation.parse(
      boundedJson(args.proofJson, 65536),
    );
    if (
      row.creditGrantId !== proof.creditGrantId ||
      row.paymentIntentId !== proof.paymentIntentId ||
      proof.currency !== parsed.terms.binding.plan.rate.currency
    )
      throw new Error("Credit observation provenance mismatch");
    const grant = await ctx.db
      .query("usageCreditGrants")
      .withIndex("by_purchase", (q) => q.eq("purchaseKey", row.key))
      .unique();
    if (!grant) throw new Error("Credit grant unavailable");
    const result = normalizeCreditState(
      parsed.terms,
      grant,
      proof,
      proof.invoicesVerified && proof.complete,
    );
    if (
      row.state === "frozen" &&
      (BigInt(grant.reserved) > 0n ||
        BigInt(grant.consumed) > 0n ||
        proof.ledgerAmount > 0)
    ) {
      result.backing = "held";
      result.reason = "credit_purchase_frozen";
    }
    for (const tx of proof.transactions)
      await history(ctx, row.accountKey, "observation", tx.id, tx, row.key);
    const ledger = await account(ctx, row.accountKey);
    if ((grant.observedAt ?? -1) <= args.startedAt) {
      await ctx.db.patch("usageCreditGrants", grant._id, {
        nativeUnused: proof.ledgerAmount > 0,
        nativeObservationJson: JSON.stringify(proof),
        observedAt: args.startedAt,
        ...(proof.expired > 0 || proof.voided > 0
          ? { frozen: true, nativeExpired: true }
          : {}),
      });
      if (result.backing === "held")
        await ctx.db.patch("usageCreditAccounts", ledger._id, {
          frozenReason: result.reason!,
        });
    }
    await history(
      ctx,
      row.accountKey,
      "observation",
      proof.creditGrantId,
      {
        native: {
          ledgerAmount: proof.ledgerAmount,
          availableAmount: proof.availableAmount,
          granted: proof.granted,
          applied: proof.applied,
          expired: proof.expired,
          voided: proof.voided,
          reinstated: proof.reinstated,
          complete: proof.complete,
        },
        backing: result.backing,
        reason: result.reason,
        transactionCount: proof.transactions.length,
      },
      row.key,
    );
    return JSON.stringify(result);
  },
});

export const closeAccount = mutation({
  args: { bindingJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    const ledger = await account(ctx, original.key);
    if (ledger.closed) return null;
    const purchases = await ctx.db
      .query("usageCreditPurchases")
      .withIndex("by_account", (q) => q.eq("accountKey", original.key))
      .take(1001);
    if (
      purchases.length > 1000 ||
      purchases.some((p) => !p.creditGrantId && p.state !== "canceled")
    )
      throw new Error("Credit purchases require reconciliation before closure");
    for (const grant of await grants(ctx, original.key)) {
      const proof = grant.nativeObservationJson
        ? creditNativeObservation.parse(JSON.parse(grant.nativeObservationJson))
        : null;
      const purchaseRow = await purchase(ctx, grant.purchaseKey),
        terms = (await purchaseTerms(purchaseRow.termsJson)).terms;
      if (
        BigInt(grant.available) > 0n &&
        !(
          terms.expiresAt !== undefined && terms.expiresAt <= Date.now() / 1000
        ) &&
        purchaseRow.refundedAmount !== terms.amount
      )
        throw new Error(
          "Unspent paid credits require verified refund before closure",
        );
      const consumed =
        BigInt(grant.consumed) === 0n
          ? 0
          : creditCost(terms.binding.plan, grant.consumed);
      if (
        BigInt(grant.reserved) !== 0n ||
        !proof?.complete ||
        !proof.invoicesVerified ||
        proof.ledgerAmount !== 0 ||
        proof.availableAmount !== 0 ||
        proof.reinstated !== 0 ||
        proof.applied !== consumed
      )
        throw new Error(
          "Credit backing and consumption require reconciliation before closure",
        );
    }
    await ctx.db.patch("usageCreditAccounts", ledger._id, { closed: true });
    await history(ctx, ledger.key, "closure", ledger.key, {
      cashCollection: "none",
      originalTermsRetained: true,
    });
    return null;
  },
});

export const cancelPurchase = mutation({
  args: { key: v.string(), paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await purchase(ctx, args.key);
    if (
      row.paymentIntentId !== args.paymentIntentId ||
      row.creditGrantId ||
      row.paymentProofJson
    )
      throw new Error(
        "Only an original unpaid credit purchase can be canceled",
      );
    await ctx.db.patch("usageCreditPurchases", row._id, {
      state: "canceled",
      capacityReserved: false,
    });
    await history(
      ctx,
      row.accountKey,
      "recovery",
      args.paymentIntentId,
      { nativeStatus: "canceled", cashCollection: "none" },
      row.key,
    );
    return null;
  },
});

export const prepareRefund = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await purchase(ctx, args.key),
      grant = await ctx.db
        .query("usageCreditGrants")
        .withIndex("by_purchase", (q) => q.eq("purchaseKey", row.key))
        .unique();
    if (
      !grant ||
      !row.creditGrantId ||
      !row.paymentProofJson ||
      row.state === "canceled"
    )
      throw new Error("Verified credit purchase required");
    if (BigInt(grant.reserved) !== 0n || BigInt(grant.consumed) !== 0n)
      throw new Error(
        "Consumed or reserved credits require recovery reconciliation",
      );
    if (row.state === "frozen") return null;
    const proof = grant.nativeObservationJson
      ? creditNativeObservation.parse(JSON.parse(grant.nativeObservationJson))
      : null;
    const terms = (await purchaseTerms(row.termsJson)).terms;
    if (
      !proof?.complete ||
      !proof.invoicesVerified ||
      Date.now() - (grant.observedAt ?? 0) > 60000 ||
      proof.ledgerAmount !== terms.amount ||
      proof.applied !== 0 ||
      proof.reinstated !== 0 ||
      proof.expired !== 0 ||
      proof.voided !== 0
    )
      throw new Error("Current unspent native credit reconciliation required");
    await ctx.db.patch("usageCreditGrants", grant._id, { frozen: true });
    await ctx.db.patch("usageCreditPurchases", row._id, { state: "frozen" });
    await history(
      ctx,
      row.accountKey,
      "recovery",
      row.creditGrantId,
      {
        reason: "refund_requested",
        originalPaymentIntentId: row.paymentIntentId!,
      },
      row.key,
    );
    return null;
  },
});

export const resumeAccount = mutation({
  args: { bindingJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const original = await accountTerms(
        boundedJson(args.bindingJson) as UsageCreditBinding,
      ),
      ledger = await account(ctx, original.key);
    if (ledger.closed) throw new Error("Closed credit account cannot resume");
    const evidence = [];
    for (const grant of await grants(ctx, original.key)) {
      const row = await purchase(ctx, grant.purchaseKey),
        terms = (await purchaseTerms(row.termsJson)).terms;
      const proof = grant.nativeObservationJson
        ? creditNativeObservation.parse(JSON.parse(grant.nativeObservationJson))
        : null;
      if (
        !proof ||
        !proof.complete ||
        !proof.invoicesVerified ||
        Date.now() - (grant.observedAt ?? 0) > 60000 ||
        normalizeCreditState(terms, grant, proof, true).backing !==
          "sufficient" ||
        (row.state === "frozen" &&
          (BigInt(grant.reserved) > 0n ||
            BigInt(grant.consumed) > 0n ||
            proof.ledgerAmount > 0))
      )
        throw new Error(
          "Fresh complete funding and invoice reconciliation required before resume",
        );
      evidence.push({
        creditGrantId: grant.creditGrantId,
        observedAt: grant.observedAt!,
      });
    }
    await ctx.db.patch("usageCreditAccounts", ledger._id, {
      frozenReason: undefined,
    });
    await history(ctx, ledger.key, "recovery", ledger.key, {
      reason: "verified_observation_resume",
      grantCount: evidence.length,
      observationFingerprint: await canonicalFingerprint(evidence),
    });
    return null;
  },
});

export const markPaymentAttempt = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await purchase(ctx, args.key);
    if (row.state !== "pending" || !row.capacityReserved)
      throw new Error("Original purchase no longer permits payment creation");
    await ctx.db.patch("usageCreditPurchases", row._id, {
      paymentAttemptedAt:
        row.paymentAttemptedAt ?? Math.floor(Date.now() / 1000),
    });
    return null;
  },
});
export const cancelUnstarted = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await purchase(ctx, args.key);
    if (
      row.paymentAttemptedAt !== undefined ||
      row.paymentIntentId ||
      row.paymentProofJson ||
      row.creditGrantId
    )
      throw new Error("Unknown native payment requires reconciliation");
    await ctx.db.patch("usageCreditPurchases", row._id, {
      state: "canceled",
      capacityReserved: false,
    });
    await history(ctx, row.accountKey, "recovery", row.key, {
      reason: "canceled_before_native_payment_attempt",
    });
    return null;
  },
});
