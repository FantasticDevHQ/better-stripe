import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
type PayoutData = Omit<
  Doc<"payouts">,
  "_id" | "_creationTime" | "totalsRecorded"
>;
/** The caller's triggered DB maintains the existing exact currency summaries. */
export async function writePayout(ctx: MutationCtx, args: PayoutData) {
  const existing = await ctx.db
    .query("payouts")
    .withIndex("by_stripe_payout_id", (q) =>
      q.eq("stripePayoutId", args.stripePayoutId),
    )
    .first();
  const id = existing?._id ?? (await ctx.db.insert("payouts", args));
  if (existing)
    await ctx.db.patch("payouts", id, {
      ...args,
      failureCode: args.failureCode,
      failureMessage: args.failureMessage,
    });
  const saved = await ctx.db.get("payouts", id);
  if (!saved) throw new Error("Payout was not found after synchronization.");
  return saved;
}
