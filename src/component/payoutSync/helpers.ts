import type { Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import type { snapshot } from "./validators.js";
export function validateIdentity(args: {
  stripePayoutId: string;
  accountId: string;
}) {
  if (
    !/^po_[A-Za-z0-9_]+$/.test(args.stripePayoutId) ||
    args.stripePayoutId.length > 255 ||
    (args.accountId !== "platform" &&
      !/^acct_[A-Za-z0-9_]+$/.test(args.accountId)) ||
    args.accountId.length > 255
  )
    throw new Error("Invalid payout synchronization identity.");
}
export async function claimByPayout(
  ctx: QueryCtx | MutationCtx,
  args: { stripePayoutId: string; accountId: string },
) {
  validateIdentity(args);
  const claim = await ctx.db
    .query("payoutSyncClaims")
    .withIndex("by_stripe_payout_id", (q) =>
      q.eq("stripePayoutId", args.stripePayoutId),
    )
    .unique();
  if (claim && claim.accountId !== args.accountId)
    throw new Error("Payout synchronization account does not match.");
  return claim;
}
export async function payoutById(
  ctx: QueryCtx | MutationCtx,
  args: { stripePayoutId: string; accountId: string },
) {
  const payout = await ctx.db
    .query("payouts")
    .withIndex("by_stripe_payout_id", (q) =>
      q.eq("stripePayoutId", args.stripePayoutId),
    )
    .unique();
  if (payout && payout.accountId !== args.accountId)
    throw new Error("Existing payout account does not match.");
  return payout;
}
export function validateSnapshot(p: Infer<typeof snapshot>) {
  validateIdentity(p);
  if (
    !Number.isSafeInteger(p.amount) ||
    p.amount <= 0 ||
    !/^[a-z]{3}$/.test(p.currency) ||
    (p.method !== undefined && !["standard", "instant"].includes(p.method))
  )
    throw new Error("Invalid payout synchronization money or method.");
  if (
    p.arrivalDate !== undefined &&
    (!Number.isFinite(Date.parse(p.arrivalDate)) ||
      new Date(p.arrivalDate).toISOString() !== p.arrivalDate)
  )
    throw new Error("Invalid payout arrival date.");
  if (
    (p.failureCode !== undefined && p.failureCode.length > 255) ||
    (p.failureMessage !== undefined && p.failureMessage.length > 4096)
  )
    throw new Error("Invalid payout failure detail.");
}
export async function fingerprint(p: Infer<typeof snapshot> | Doc<"payouts">) {
  return generateIdempotencyKey("payout-sync", {
    snapshot: [
      p.stripePayoutId,
      p.accountId,
      p.amount,
      p.currency,
      p.status,
      p.arrivalDate,
      p.method,
      p.failureCode,
      p.failureMessage,
      Object.entries(p.metadata ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ],
  });
}
