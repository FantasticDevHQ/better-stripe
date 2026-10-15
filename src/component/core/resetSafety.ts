import type { MutationCtx } from "../_generated/server.js";
/** A database reset cannot erase the only restoration or unresolved-payout record. */
export async function assertPayoutResetSafe(ctx: MutationCtx) {
  const [bound, custom, changing, reserved, submitted, pending, transit] =
    await Promise.all([
      ctx.db
        .query("payoutSnapshots")
        .withIndex("by_read_only", (q) => q.eq("readOnly", false))
        .first(),
      ctx.db
        .query("payoutPolicies")
        .withIndex("by_mode_status", (q) => q.eq("mode", "custom"))
        .first(),
      ctx.db
        .query("payoutPolicies")
        .withIndex("by_mode_status", (q) =>
          q.eq("mode", "stripe_managed").eq("status", "changing"),
        )
        .first(),
      ctx.db
        .query("payoutReleaseClaims")
        .withIndex("by_status", (q) => q.eq("status", "reserved"))
        .first(),
      ctx.db
        .query("payoutReleaseClaims")
        .withIndex("by_status", (q) => q.eq("status", "submitted"))
        .first(),
      ctx.db
        .query("payouts")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .first(),
      ctx.db
        .query("payouts")
        .withIndex("by_status", (q) => q.eq("status", "in_transit"))
        .first(),
    ]);
  if (bound)
    throw new Error(
      "A financially bound payout collection must be resolved before reset.",
    );
  if (custom || changing)
    throw new Error(
      "Restore and verify payout schedules before reset; restoration records cannot be erased.",
    );
  if (reserved || submitted)
    throw new Error(
      "Resolve payout claims before reset; unresolved reservations cannot be erased.",
    );
  if (pending || transit)
    throw new Error("Verify in-flight provider payouts before reset.");
}
