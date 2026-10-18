import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
export const seed = mutation({
  args: {
    start: v.number(),
    count: v.number(),
    suffix: v.string(),
    shared: v.boolean(),
  },
  handler: async (ctx, a) => {
    for (let i = a.start; i < a.start + a.count; i++) {
      const bucket = `capacity230_${a.suffix}_${a.shared ? i % 4 : i}`;
      if (i % 2 === 0 && (!a.shared || i < 4))
        await ctx.runMutation(
          components.betterStripe.financialOwnership.mutations.register,
          {
            bucketKey: bucket,
            kind: "logical",
            userId: `owner_${a.suffix}`,
            source: { integration: "capacity230-native", recordId: bucket },
          },
        );
      await ctx.runMutation(
        components.betterStripe.connect.mutations.upsertTransfer,
        {
          stripeTransferId: `tr230_${a.suffix}_${i}`,
          sourceChargeId: `ch230_${a.suffix}`,
          destinationAccountId: bucket,
          amount: 1,
          currency: i % 2 === 0 ? "usd" : "eur",
          role: "store",
          status: "paid",
        },
      );
    }
    return { inserted: a.count };
  },
});
export const claim = mutation({
  args: { suffix: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.runMutation(
      components.betterStripe.connect.mutations.claimReversalSlices,
      {
        operationId: `op230_${a.suffix}`,
        sourceChargeId: `ch230_${a.suffix}`,
        mode: { kind: "full" },
      },
    );
    const originals = new Set(
      Array.from({ length: 1000 }, (_, i) => `tr230_${a.suffix}_${i}`),
    );
    if (
      r.slices.length !== 1000 ||
      r.slices.some((s) => s.from !== 0 || s.to !== 1 || s.confirmed !== 0) ||
      new Set(r.slices.map((s) => s.stripeTransferId)).size !== 1000 ||
      r.slices.some((s) => !originals.has(s.stripeTransferId))
    )
      throw Error("Claim did not preserve every actual slice");
    return {
      count: r.slices.length,
      replay: r.replay,
      allOriginalSliceBytesEqual: true,
    };
  },
});
export const release = mutation({
  args: { suffix: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.runMutation(
      components.betterStripe.connect.mutations.releaseReversalClaim,
      {
        operationId: `op230_${a.suffix}`,
        verified: Array.from({ length: 1000 }, (_, i) => ({
          stripeTransferId: `tr230_${a.suffix}_${i}`,
          amountReversed: 0,
        })),
      },
    );
    if (
      !r.released ||
      r.rewound.length !== 1000 ||
      r.rewound.some((s) => s.to !== 0) ||
      new Set(r.rewound.map((s) => s.stripeTransferId)).size !== 1000
    )
      throw Error("Release did not preserve every actual slice");
    return {
      count: r.rewound.length,
      released: r.released,
      allOriginalReferencesEqual: true,
    };
  },
});
export const verify = query({
  args: {
    suffix: v.string(),
    start: v.number(),
    count: v.number(),
    frontier: v.number(),
    shared: v.boolean(),
    expectedRisk: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    let registered = 0;
    let unknown = 0;
    for (let i = a.start; i < a.start + a.count; i++) {
      const bucket = `capacity230_${a.suffix}_${a.shared ? i % 4 : i}`;
      const row = await ctx.runQuery(
        components.betterStripe.connect.queries.getTransferByStripeId,
        { stripeTransferId: `tr230_${a.suffix}_${i}` },
      );
      if (
        !row ||
        row.amount !== 1 ||
        row.currency !== (i % 2 === 0 ? "usd" : "eur") ||
        row.destinationAccountId !== bucket ||
        (row.reversalClaimedAmount ?? 0) !== a.frontier ||
        row.reversedAmount !== undefined ||
        !row.totalsRecorded
      )
        throw Error("Financial source mismatch");
      const totals = await ctx.runQuery(
        components.betterStripe.connect.queries.getAccountEarningsByCurrency,
        { destinationAccountId: bucket, previewLimit: 0 },
      );
      const total = totals.totals[0];
      if (
        totals.totals.length !== 1 ||
        total.gross !== (a.shared ? 250 : 1) ||
        total.reversed !== 0 ||
        total.transferCount !== (a.shared ? 250 : 1)
      )
        throw Error("Currency earnings mismatch");
      const quote = await ctx.runQuery(
        components.betterStripe.costRecovery.queries.payoutQuote,
        {
          accountId: bucket,
          scopeKey: "capacity-evidence",
          currency: row.currency,
        },
      );
      if (quote.liabilityRevision !== (a.expectedRisk ?? a.frontier))
        throw Error("Risk revision mismatch");
      const diagnostic = await ctx.runQuery(
        components.betterStripe.financialObservations.queries.transfer,
        { transferId: row._id },
      );
      if (
        diagnostic.coverage !== "unknown" ||
        diagnostic.observation?.generation !== 1
      )
        throw Error("Observation leaked frontier batch");
      if (diagnostic.observation.ownershipStatus === "registered") registered++;
      else if (diagnostic.observation.ownershipStatus === "unknown") unknown++;
      else throw Error("Owner mismatch");
    }
    const op = await ctx.runQuery(
      components.betterStripe.connect.queries.getReversalOp,
      { operationId: `op230_${a.suffix}` },
    );
    return {
      verified: a.count,
      registered,
      unknown,
      financialSourceIdentityPreserved: true,
      perCurrencyEarningsExact: true,
      operationPresent: op !== null,
    };
  },
});
export const smallStep = mutation({
  args: {
    suffix: v.string(),
    step: v.union(
      v.literal("seed"),
      v.literal("update"),
      v.literal("reverse"),
      v.literal("move"),
      v.literal("invalid"),
    ),
  },
  handler: async (ctx, a) => {
    const base = {
      stripeTransferId: `tr_small_${a.suffix}`,
      sourceChargeId: `ch_small_${a.suffix}`,
      destinationAccountId: `acct_small_${a.suffix}`,
      amount: 5,
      currency: "usd",
      status: "paid" as const,
    };
    if (a.step === "reverse")
      await ctx.runMutation(
        components.betterStripe.connect.mutations.recordTransferReversal,
        { stripeTransferId: base.stripeTransferId, reversedAmount: 2 },
      );
    else
      await ctx.runMutation(
        components.betterStripe.connect.mutations.upsertTransfer,
        {
          ...base,
          ...(a.step === "update" ? { amount: 7 } : {}),
          ...(a.step === "move"
            ? {
                amount: 7,
                currency: "eur",
                destinationAccountId: `acct_other_${a.suffix}`,
              }
            : {}),
          ...(a.step === "invalid" ? { amount: 0.5 } : {}),
        },
      );
    return { step: a.step };
  },
});
export const smallRead = query({
  args: { suffix: v.string() },
  handler: async (ctx, a) => {
    const totals = [];
    const risks = [];
    for (const accountId of [
      `acct_small_${a.suffix}`,
      `acct_other_${a.suffix}`,
    ]) {
      const r = await ctx.runQuery(
        components.betterStripe.connect.queries.getAccountEarningsByCurrency,
        { destinationAccountId: accountId, previewLimit: 0 },
      );
      totals.push(r.totals);
      const q = await ctx.runQuery(
        components.betterStripe.costRecovery.queries.payoutQuote,
        { accountId, scopeKey: "capacity-evidence", currency: "usd" },
      );
      risks.push(q.liabilityRevision);
    }
    const row = await ctx.runQuery(
      components.betterStripe.connect.queries.getTransferByStripeId,
      { stripeTransferId: `tr_small_${a.suffix}` },
    );
    return {
      totals,
      risks,
      source: row
        ? {
            amount: row.amount,
            currency: row.currency,
            reversed: row.reversedAmount ?? 0,
            totalsRecorded: row.totalsRecorded,
            destinationIsOther:
              row.destinationAccountId === `acct_other_${a.suffix}`,
          }
        : null,
    };
  },
});
