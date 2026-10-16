import { v } from "convex/values";

import { query } from "../../../_generated/server";

import { planValidator, plans } from "../helpers";

export const list = query({
  args: {},
  returns: v.array(planValidator),
  handler: plans,
});
