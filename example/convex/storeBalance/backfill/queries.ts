import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { runDoc } from "./validators";
import { doc } from "../funding/helpers";
export const state = internalQuery({
  args: { runId: v.id("storeBalanceMigrationRuns") },
  returns: v.union(runDoc, v.null()),
  handler: (ctx, args) => ctx.db.get("storeBalanceMigrationRuns", args.runId),
});
export const row = internalQuery({
  args: { fundingId: v.id("storeBalanceFunding") },
  returns: v.union(doc, v.null()),
  handler: (ctx, args) => ctx.db.get("storeBalanceFunding", args.fundingId),
});
