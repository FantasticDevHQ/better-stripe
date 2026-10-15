import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { writePayout } from "../connect/payoutWrites.js";
import {
  claimByPayout,
  payoutById,
  validateSnapshot,
  fingerprint,
} from "./helpers.js";
import { identity, prepared, result } from "./validators.js";
export const begin = mutation({
  args: identity,
  returns: v.number(),
  handler: async (ctx, args) => {
    const claim = await claimByPayout(ctx, args);
    await payoutById(ctx, args);
    const generation = (claim?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation))
      throw new Error("Payout synchronization generation exhausted.");
    if (claim)
      await ctx.db.patch("payoutSyncClaims", claim._id, {
        generation,
        status: "pending",
        startedAt: Date.now(),
      });
    else
      await ctx.db.insert("payoutSyncClaims", {
        ...args,
        generation,
        status: "pending",
        startedAt: Date.now(),
      });
    return generation;
  },
});
export const finish = mutation({
  args: prepared,
  returns: result,
  handler: async (ctx, args) => {
    const claim = await claimByPayout(ctx, args);
    if (!claim) throw new Error("Payout synchronization claim is missing.");
    if (claim.generation !== args.generation)
      return { status: "superseded" as const, generation: args.generation };
    validateSnapshot(args.payout);
    if (
      args.payout.accountId !== args.accountId ||
      args.payout.stripePayoutId !== args.stripePayoutId
    )
      throw new Error(
        "Payout synchronization snapshot identity does not match.",
      );
    const existing = await payoutById(ctx, args);
    if (
      existing &&
      (existing.amount !== args.payout.amount ||
        existing.currency !== args.payout.currency)
    )
      throw new Error("Existing payout original money does not match.");
    const nextFingerprint = await fingerprint(args.payout);
    if (
      claim.status === "accepted" &&
      claim.acceptedFingerprint !== nextFingerprint
    )
      throw new Error("An accepted payout observation cannot be replaced.");
    const changed =
      !existing || (await fingerprint(existing)) !== nextFingerprint;
    if (claim.status === "accepted" && changed)
      throw new Error(
        "Accepted payout state changed outside its synchronization.",
      );
    if (claim.status === "accepted")
      return {
        status: "accepted" as const,
        generation: args.generation,
        changed: false,
        payout: existing!,
      };
    const payout = changed ? await writePayout(ctx, args.payout) : existing!;
    await ctx.db.patch("payoutSyncClaims", claim._id, {
      status: "accepted",
      acceptedGeneration: args.generation,
      acceptedAt: Date.now(),
      acceptedFingerprint: nextFingerprint,
    });
    return {
      status: "accepted" as const,
      generation: args.generation,
      changed,
      payout,
    };
  },
});
export const markUnknown = mutation({
  args: { ...identity, generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await claimByPayout(ctx, args);
    if (claim?.generation === args.generation && claim.status === "pending")
      await ctx.db.patch("payoutSyncClaims", claim._id, { status: "unknown" });
    return null;
  },
});
