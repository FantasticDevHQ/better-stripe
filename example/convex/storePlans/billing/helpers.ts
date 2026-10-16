import { v } from "convex/values";

import { storePlanRecordValidator } from "../validators";

export const sellerValidator = v.object({
  sellerId: v.id("users"),
  name: v.string(),
  email: v.string(),
  stripeAccountId: v.optional(v.string()),
  storePlan: v.optional(storePlanRecordValidator),
});
