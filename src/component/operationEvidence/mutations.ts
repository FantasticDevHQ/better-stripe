import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { readState } from "./helpers.js";
import { captureSource } from "./maintenance.js";
import { captureResult } from "./schema.js";

export const capture = mutation({
  args: { sourceId: v.id("transferReversalOps") },
  returns: captureResult,
  handler: async (ctx, args) => ({
    ...(await captureSource(ctx, args.sourceId)),
    ...(await readState(ctx)),
  }),
});
