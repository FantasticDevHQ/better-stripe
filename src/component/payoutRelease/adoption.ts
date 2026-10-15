import type { Doc } from "../_generated/dataModel.js";
import { adoptionCollection } from "../payoutSnapshots/adoption.js";
import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { scopeFields } from "../payoutPolicy/schema.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
import { observation, allocation } from "./schema.js";
import {
  add,
  checkSnapshot,
  sourceById,
  payoutClaimFingerprint,
} from "./helpers.js";
import { recordFees } from "./fees.js";
export const historicalArgs = {
  ...scopeFields,
  expectedRevision: v.number(),
  payout: v.object({
    stripePayoutId: v.string(),
    amount: v.number(),
    currency: v.string(),
    created: v.number(),
    destinationId: v.string(),
    status: v.union(v.literal("paid"), v.literal("returned")),
    debitTransactionId: v.string(),
    debitFee: v.number(),
    returnTransactionId: v.optional(v.string()),
    returnFee: v.optional(v.number()),
  }),
  allocations: v.array(allocation),
  observations: v.array(observation),
};
type Args = {
  [K in keyof typeof historicalArgs]: Infer<(typeof historicalArgs)[K]>;
};
/** Trusted package observations only. Provider history and historical maturity are verified upstream. */
export async function adoptHistoricalPayout(
  ctx: MutationCtx,
  args: Args,
  collected?: Map<string, Doc<"transfers">>,
) {
  const policy = await readPolicy(ctx, args);
  if (!policy || policy.revision !== args.expectedRevision)
    throw new Error("Historical payout policy revision changed.");
  if (policy.mode !== "stripe_managed" || policy.status !== "ready")
    throw new Error(
      "Historical adoption requires an inactive automatic policy.",
    );
  const p = args.payout;
  if (
    !/^po_\w+$/.test(p.stripePayoutId) ||
    !/^ba_\w+$/.test(p.destinationId) ||
    !/^[a-z]{3}$/.test(p.currency) ||
    !Number.isSafeInteger(p.amount) ||
    p.amount <= 0 ||
    !Number.isSafeInteger(p.created) ||
    p.created < 0 ||
    p.created * 1000 > Date.now() ||
    !Number.isSafeInteger(p.created * 1000) ||
    !/^txn_\w+$/.test(p.debitTransactionId) ||
    !Number.isSafeInteger(p.debitFee) ||
    p.debitFee < 0 ||
    (p.status === "returned"
      ? !p.returnTransactionId ||
        !/^txn_\w+$/.test(p.returnTransactionId) ||
        !Number.isSafeInteger(p.returnFee)
      : p.returnTransactionId !== undefined || p.returnFee !== undefined)
  )
    throw new Error("Invalid historical payout receipt.");
  const rows =
    collected ??
    (await checkSnapshot(ctx, args.accountId, args.observations, true));
  const byObservation = new Map(
    args.observations.map((o) => [o.stripeTransferId, o]),
  );
  const seen = new Set<string>();
  let total = 0;
  const allocations = args.allocations
    .map((a) => {
      if (
        !Number.isSafeInteger(a.amount) ||
        a.amount <= 0 ||
        seen.has(a.stripeTransferId) ||
        !rows.has(a.stripeTransferId) ||
        byObservation.get(a.stripeTransferId)?.currency !== p.currency
      )
        throw new Error("Invalid historical source allocation.");
      seen.add(a.stripeTransferId);
      total = add(total, a.amount);
      const role = rows.get(a.stripeTransferId)!.role;
      return {
        stripeTransferId: a.stripeTransferId,
        amount: a.amount,
        ...(role ? { role } : {}),
      };
    })
    .sort((a, b) => a.stripeTransferId.localeCompare(b.stripeTransferId));
  if (total !== p.amount)
    throw new Error(
      "Historical source allocations do not equal payout principal.",
    );
  const operationKey = `bs:historical:${p.stripePayoutId}`;
  const old = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_provider_payout", (q) =>
      q.eq("stripePayoutId", p.stripePayoutId),
    )
    .unique();
  if (old) {
    if (
      !old.historical ||
      old.accountId !== args.accountId ||
      old.ownerKey !== args.ownerKey ||
      old.operationKey !== operationKey ||
      old.currency !== p.currency ||
      old.amount !== p.amount ||
      old.destinationId !== p.destinationId ||
      old.attemptedAt !== p.created * 1000 ||
      old.status !== p.status ||
      old.debitTransactionId !== p.debitTransactionId ||
      old.debitFee !== p.debitFee ||
      old.returnTransactionId !== p.returnTransactionId ||
      old.providerFee !== add(p.debitFee, p.returnFee ?? 0) ||
      JSON.stringify(
        old.allocations.map((a) => [a.stripeTransferId, a.amount, a.role]),
      ) !==
        JSON.stringify(
          allocations.map((a) => [a.stripeTransferId, a.amount, a.role]),
        )
    )
      throw new Error(
        "Historical payout identity or source allocation changed; reconcile existing outcomes.",
      );
    return old;
  }
  for (const status of ["reserved", "submitted"] as const) {
    const unresolved = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) =>
        q.eq("accountId", args.accountId).eq("status", status),
      )
      .first();
    if (unresolved)
      throw new Error(
        "Resolve existing payout attempts before historical adoption.",
      );
  }
  if (!collected) {
    const history = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) => q.eq("accountId", args.accountId))
      .take(100);
    if (history.length >= 100)
      throw new Error("Historical payout snapshot limit exceeded.");
  }
  for (const a of allocations) {
    const source = await sourceById(ctx, a.stripeTransferId);
    if (
      source &&
      (source.accountId !== args.accountId ||
        source.ownerKey !== args.ownerKey ||
        source.currency !== p.currency ||
        source.reservedAmount !== 0)
    )
      throw new Error(
        "Historical source allocation identity or reservations changed.",
      );
    const paid = p.status === "paid" ? a.amount : 0;
    if (source)
      await ctx.db.patch("payoutSourceAllocations", source._id, {
        paidAmount: add(source.paidAmount, paid),
      });
    else
      await ctx.db.insert("payoutSourceAllocations", {
        accountId: args.accountId,
        ownerKey: args.ownerKey,
        stripeTransferId: a.stripeTransferId,
        currency: p.currency,
        paidAmount: paid,
        reservedAmount: 0,
      });
  }
  const id = await ctx.db.insert("payoutReleaseClaims", {
    accountId: args.accountId,
    ownerKey: args.ownerKey,
    operationKey,
    expectedRevision: args.expectedRevision,
    historical: true,
    currency: p.currency,
    amount: p.amount,
    destinationId: p.destinationId,
    allocations,
    observations: args.observations,
    status: p.status,
    attemptedAt: p.created * 1000,
    stripePayoutId: p.stripePayoutId,
    ...(p.returnTransactionId
      ? { returnTransactionId: p.returnTransactionId }
      : {}),
  });
  const claim = (await ctx.db.get("payoutReleaseClaims", id))!;
  await recordFees(
    ctx,
    claim,
    {
      debitTransactionId: p.debitTransactionId,
      debitFee: p.debitFee,
      ...(p.returnFee !== undefined ? { returnFee: p.returnFee } : {}),
    },
    p.status === "returned",
  );
  return (await ctx.db.get("payoutReleaseClaims", id))!;
}

export const historicalBatchArgs = {
  snapshotId: v.optional(v.id("payoutSnapshots")),
  ...scopeFields,
  expectedRevision: v.number(),
  observations: v.array(observation),
  expectedClaims: v.array(
    v.object({ operationKey: v.string(), fingerprint: v.string() }),
  ),
  payouts: v.array(
    v.object({
      payout: historicalArgs.payout,
      allocations: historicalArgs.allocations,
    }),
  ),
};
type BatchArgs = {
  [K in keyof typeof historicalBatchArgs]: Infer<
    (typeof historicalBatchArgs)[K]
  >;
};
export async function adoptHistoricalBatch(ctx: MutationCtx, args: BatchArgs) {
  if (!args.payouts.length || (!args.snapshotId && args.payouts.length > 100))
    throw new Error("Invalid historical payout batch size.");
  const collected = await adoptionCollection(ctx, args, {
    snapshotId: args.snapshotId,
    observations: args.observations,
    claims: args.expectedClaims,
  });
  const validated = collected
    ? await checkSnapshot(
        ctx,
        args.accountId,
        args.observations,
        true,
        undefined,
        collected.sources,
      )
    : undefined;
  const rows =
    collected?.claims ??
    (await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) => q.eq("accountId", args.accountId))
      .take(101));
  const expected = new Map(
    args.expectedClaims.map((c) => [c.operationKey, c.fingerprint]),
  );
  if (
    (!collected && rows.length > 100) ||
    expected.size !== args.expectedClaims.length ||
    rows.length !== expected.size ||
    rows.some(
      (c) =>
        c.ownerKey !== args.ownerKey ||
        expected.get(c.operationKey) !== payoutClaimFingerprint(c),
    )
  )
    throw new Error("Historical payout history snapshot changed.");
  const claims = [];
  for (const p of args.payouts)
    claims.push(
      await adoptHistoricalPayout(
        ctx,
        {
          accountId: args.accountId,
          ownerKey: args.ownerKey,
          expectedRevision: args.expectedRevision,
          observations: args.observations,
          ...p,
        },
        validated,
      ),
    );
  return { claims };
}
