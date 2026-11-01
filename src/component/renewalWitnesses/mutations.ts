import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { descriptor, identity } from "./schema.js";
import { retainWitness } from "./protocol.js";

/** Trusted host component API. Host authorization and live capture remain separate requirements. */
export const retainAuthorizedWitness = mutation({
  args: { identity, payloadJSON: v.string() },
  returns: v.union(
    v.object({ status: v.literal("retained"), descriptor }),
    v.object({
      status: v.literal("conflict"),
      reason: v.literal("identity_changed"),
    }),
  ),
  handler: retainWitness,
});
