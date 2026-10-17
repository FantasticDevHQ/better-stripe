import type { QueryCtx } from "../../_generated/server";

/** Opt-in authenticated reference; synthetic persona selection is never authentication. */
export async function historyActor(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  const users = await ctx.db.query("users").withIndex("by_auth_token", q =>
    q.eq("authTokenIdentifier", identity.tokenIdentifier),
  ).take(2);
  const user = users[0];
  if (users.length !== 1 || !user || !["buyer", "customer"].includes(user.role))
    throw new Error("Authentication required");
  return user;
}
