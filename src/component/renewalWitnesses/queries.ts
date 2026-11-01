import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { descriptor, identity } from "./schema.js";
import { readWitness } from "./protocol.js";

/** Trusted host component API. A fresh host read grant must precede any external release. */
export const readAuthorizedWitness = query({
  args: { identity },
  returns: v.union(v.null(), v.object({ descriptor, payloadJSON: v.string() })),
  handler: (ctx, args) => readWitness(ctx, args.identity),
});
