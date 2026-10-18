import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
export type DemoRef = { actorId: Id<"users">; runId: Id<"meteredDemoRuns"> };
/** Durable fixture provenance. Never extend an uncertain provider create beyond its safe retry window. */
export async function ensureDemoResource<T extends { id: string }>(
  ctx: Pick<ActionCtx, "runMutation">,
  ref: DemoRef,
  kind: string,
  retrieve: (id: string) => Promise<T>,
  create: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const intent = await ctx.runMutation(
    internal.meteredUsage.state.prepareResource,
    { ...ref, kind },
  );
  if (intent.stripeId) {
    const resource = await retrieve(intent.stripeId);
    if (resource.id !== intent.stripeId)
      throw new Error("Native fixture identity changed.");
    return resource;
  }
  if (Date.now() - intent.createdAt >= 23 * 3600 * 1000)
    throw new Error(
      "Reconcile the original native fixture create before continuing.",
    );
  const resource = await create(`bs_demo_${ref.runId}_${kind}`);
  await ctx.runMutation(internal.meteredUsage.state.pinResource, {
    ...ref,
    kind,
    stripeId: resource.id,
  });
  return resource;
}
