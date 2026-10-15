import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { claimByPayout } from "./helpers.js";
import { claimDoc } from "./schema.js";
import { identity } from "./validators.js";
export const get = query({
  args: identity,
  returns: v.union(claimDoc, v.null()),
  handler: claimByPayout,
});
