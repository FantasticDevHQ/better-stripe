import type { Component, RunCtx } from "../helpers.js";
import type { StripeMode } from "../utils/stripeDashboardUrl.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Configuration methods
// =============================================================================

export async function getPublishableKey(
  component: Component,
  ctx: RunCtx,
): Promise<string | null> {
  return (await ctx.runQuery(
    componentRef(component, "core/queries/getPublishableKey"),
    {},
  )) as string | null;
}

export async function getStripeMode(
  component: Component,
  ctx: RunCtx,
): Promise<StripeMode> {
  return (await ctx.runQuery(
    componentRef(component, "core/queries/getStripeMode"),
    {},
  )) as StripeMode;
}
