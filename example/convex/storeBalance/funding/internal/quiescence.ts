import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { legacySnapshot } from "../migration";
/** Operator attestation only: stop/drain old workers first, then record bounded audit evidence. */
export const confirm = internalMutation({
  args: {
    fundingId: v.id("storeBalanceFunding"),
    snapshot: v.string(),
    reference: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceFunding", args.fundingId);
    if (
      !row?.migrationPaused ||
      row.componentMigration?.state === "rolled_back" ||
      (await legacySnapshot(row)) !== args.snapshot
    )
      throw new Error("Legacy snapshot changed or starts are not paused.");
    if (
      !args.reference.trim() ||
      args.reference.length > 512 ||
      /[\r\n]/.test(args.reference)
    )
      throw new Error("Provide a bounded operator audit reference.");
    await ctx.db.patch("storeBalanceFunding", row._id, {
      legacyQuiescence: {
        snapshot: args.snapshot,
        reference: args.reference,
        confirmedAt: Date.now(),
      },
    });
    return null;
  },
});
