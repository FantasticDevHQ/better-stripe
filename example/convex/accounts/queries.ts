import { v } from "convex/values";

import { query } from "../_generated/server";

import { getPersonaAccount } from "./helpers";

export const getAccountByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => getPersonaAccount(ctx, args.userId),
});
