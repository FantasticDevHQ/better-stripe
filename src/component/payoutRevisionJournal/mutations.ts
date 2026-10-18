import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { activateRevisionAccount } from "./state.js";
import { activationResult } from "./schema.js";

/** Trusted-host schema migration only. Authorize the account before calling. */
export const activateAccount = mutation({
  args: { accountId: v.string() },
  returns: activationResult,
  handler: async (ctx, args) => activateRevisionAccount(ctx, args.accountId),
});
