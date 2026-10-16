import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { readState, stateValidator } from "../helpers";

export const resolve = internalQuery({
  args: {
    sellerId: v.id("users"),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  },
  returns: stateValidator,
  handler: readState,
});
