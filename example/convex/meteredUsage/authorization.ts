import { env, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertTestModeStripeKey } from "../users/authorization";
/** Matches the example's documented persona demo model. It is not production authentication. */
export async function demoActor(
  ctx: Pick<QueryCtx, "db" | "auth">,
  actorId: Id<"users">,
) {
  assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
  const actor = await ctx.db.get("users", actorId);
  const identity = await ctx.auth.getUserIdentity();
  if (
    !actor ||
    !["admin", "seller", "customer", "buyer"].includes(actor.role) ||
    (identity && identity.tokenIdentifier !== actor.authTokenIdentifier)
  )
    throw new Error("Sandbox usage is not available for this persona.");
  return actor;
}
export async function demoRun(
  ctx: Pick<QueryCtx, "db" | "auth">,
  actorId: Id<"users">,
  runId: Id<"meteredDemoRuns">,
) {
  await demoActor(ctx, actorId);
  const row = await ctx.db.get("meteredDemoRuns", runId);
  if (!row || row.actorId !== actorId)
    throw new Error("Sandbox usage is not available for this persona.");
  return row;
}
