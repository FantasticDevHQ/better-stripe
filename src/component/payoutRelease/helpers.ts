import type { Infer } from "convex/values";
import type { transferDocValidator } from "../connect/validators.js";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { readPolicy, validateScope } from "../payoutPolicy/helpers.js";
import type { observation } from "./schema.js";
import { addSummaryAmounts } from "../earnings/arithmetic.js";
export const add = addSummaryAmounts;
export function transferFingerprint(t: Infer<typeof transferDocValidator>) {
  return JSON.stringify([
    t.stripeTransferId,
    t.destinationAccountId,
    t.sourceChargeId,
    t.amount,
    t.currency,
    t.role,
    t.status,
    t.reversedAmount ?? 0,
    t.reversalClaimedAmount ?? 0,
    t.reinstatement ?? false,
  ]);
}
export function validateIdentity(args: {
  accountId: string;
  ownerKey: string;
  operationKey: string;
}) {
  validateScope(args);
  if (
    !args.operationKey.trim() ||
    args.operationKey.length > 180 ||
    /[\r\n]/.test(args.operationKey)
  )
    throw new Error("Invalid payout claim identity.");
}
export async function claimByKey(
  ctx: MutationCtx,
  args: { accountId: string; ownerKey: string; operationKey: string },
) {
  validateIdentity(args);
  const claim = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
    .unique();
  if (
    claim &&
    (claim.accountId !== args.accountId || claim.ownerKey !== args.ownerKey)
  )
    throw new Error("Payout claim identity does not match.");
  return claim;
}
export async function readyPolicy(
  ctx: MutationCtx,
  args: { accountId: string; ownerKey: string; expectedRevision: number },
) {
  const policy = await readPolicy(ctx, args);
  if (
    !Number.isSafeInteger(args.expectedRevision) ||
    policy?.revision !== args.expectedRevision ||
    policy.mode !== "custom" ||
    policy.status !== "ready" ||
    !policy.holdDeadline ||
    policy.holdDeadline <= Date.now()
  )
    throw new Error("Payout policy is not ready at this revision.");
  return policy;
}
/** Full local account membership is checked under OCC before any reservation. */
export async function checkSnapshot(
  ctx: MutationCtx,
  accountId: string,
  observations: Infer<typeof observation>[],
  fresh: boolean,
) {
  const rows = await ctx.db
    .query("transfers")
    .withIndex("by_destination_account_id", (q) =>
      q.eq("destinationAccountId", accountId),
    )
    .take(101);
  if (
    rows.length > 100 ||
    observations.length !== rows.length ||
    new Set(observations.map((o) => o.stripeTransferId)).size !== rows.length
  )
    throw new Error("Payout source snapshot is incomplete or duplicated.");
  const byId = new Map(rows.map((row) => [row.stripeTransferId, row]));
  const allocated = await ctx.db
    .query("payoutSourceAllocations")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(101);
  if (
    allocated.length > 100 ||
    allocated.some((source) => !byId.has(source.stripeTransferId))
  )
    throw new Error("Payout source allocation snapshot is incomplete.");
  const receiptIds = new Set<string>();
  for (const o of observations) {
    const row = byId.get(o.stripeTransferId);
    if (
      !row ||
      transferFingerprint(row) !== o.ledgerFingerprint ||
      (row.status !== "paid" && row.status !== "reversed") ||
      (row.reversalClaimedAmount ?? 0) > (row.reversedAmount ?? 0)
    )
      throw new Error("Payout source snapshot changed or is not ready.");
    if (
      fresh &&
      (!Number.isSafeInteger(o.observedAt) ||
        o.observedAt > Date.now() ||
        o.observedAt < Date.now() - 30000)
    )
      throw new Error("Payout source observation is stale or in the future.");
    if (
      !o.transactionIds.length ||
      o.transactionIds.length > 1000 ||
      new Set(o.transactionIds).size !== o.transactionIds.length ||
      o.transactionIds.some((id) => !/^txn_\w+$/.test(id) || id.trim() !== id)
    )
      throw new Error("Invalid payout source receipt identities.");
    for (const id of o.transactionIds) {
      if (receiptIds.has(id))
        throw new Error("Duplicate payout source receipt.");
      receiptIds.add(id);
    }
  }
  return byId;
}
export async function sourceById(ctx: MutationCtx, stripeTransferId: string) {
  return ctx.db
    .query("payoutSourceAllocations")
    .withIndex("by_transfer", (q) => q.eq("stripeTransferId", stripeTransferId))
    .unique();
}
export async function moveAllocations(
  ctx: MutationCtx,
  claim: Doc<"payoutReleaseClaims">,
  transition: "pay" | "release" | "return",
) {
  for (const allocation of claim.allocations) {
    const source = await sourceById(ctx, allocation.stripeTransferId);
    if (
      !source ||
      source.accountId !== claim.accountId ||
      source.ownerKey !== claim.ownerKey ||
      source.currency !== claim.currency
    )
      throw new Error("Payout source allocation identity changed.");
    const reservedAmount = add(
      source.reservedAmount,
      transition === "return" ? 0 : -allocation.amount,
    );
    const paidAmount = add(
      source.paidAmount,
      transition === "pay"
        ? allocation.amount
        : transition === "return"
          ? -allocation.amount
          : 0,
    );
    if (reservedAmount < 0 || paidAmount < 0)
      throw new Error("Payout source allocation underflow.");
    await ctx.db.patch("payoutSourceAllocations", source._id, {
      reservedAmount,
      paidAmount,
    });
  }
}

/** Stable financial identity for historical adoption and activation snapshots. */
export function payoutClaimFingerprint(c: Doc<"payoutReleaseClaims">) {
  return JSON.stringify([
    c.accountId,
    c.ownerKey,
    c.operationKey,
    c.historical ?? false,
    c.currency,
    c.amount,
    c.status,
    c.attemptedAt,
    c.stripePayoutId,
    c.destinationId,
    c.debitTransactionId,
    c.debitFee,
    c.providerFee,
    c.returnTransactionId,
    c.allocations.map((a) => [a.stripeTransferId, a.amount, a.role]),
  ]);
}
