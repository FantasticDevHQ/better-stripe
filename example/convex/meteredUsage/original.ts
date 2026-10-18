import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { UsageCreditPurchaseOptions } from "@fantastic.dev/better-stripe/usage";
import type { DemoRef } from "./resources";
import type { DemoProviderState } from "./types";
export async function originalDemoRun(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: DemoRef,
) {
  const run = await ctx.runQuery(internal.meteredUsage.state.read, {
    actorId: ref.actorId,
    runId: ref.runId,
  });
  if (!run.providerJson)
    throw new Error("Setup is incomplete. Resume the original sandbox setup.");
  const provider = JSON.parse(run.providerJson) as DemoProviderState;
  return { run, provider, meter: provider.meter };
}
export function demoCreditPurchase(
  meter: DemoProviderState["meter"],
  purchase: { _id: string; quantity: string },
): UsageCreditPurchaseOptions {
  return {
    scope: meter.scope,
    binding: meter.binding,
    purchaseId: purchase._id,
    quantity: purchase.quantity,
    ownership: "issuer",
    rollover: "retain_original_terms",
  };
}
