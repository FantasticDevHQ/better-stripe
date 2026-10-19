import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentProduct, StripeComponentPrice } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

/** Cache cardinality is data, not permission or provider reconciliation. */
export type ProductIdentityResult =
  | { status: "missing" }
  | { status: "unique"; product: StripeComponentProduct }
  | { status: "ambiguous" };

export type PriceIdentityResult =
  | { status: "missing" }
  | { status: "unique"; price: StripeComponentPrice }
  | { status: "ambiguous" };

export async function getProductIdentity(
  component: Component,
  ctx: RunCtx,
  opts: { stripeProductId: string },
): Promise<ProductIdentityResult> {
  return ctx.runQuery(
    componentRef(component, "products/queries/getProductIdentity"),
    opts,
  );
}

export async function getPriceIdentity(
  component: Component,
  ctx: RunCtx,
  opts: { stripePriceId: string },
): Promise<PriceIdentityResult> {
  return ctx.runQuery(
    componentRef(component, "products/queries/getPriceIdentity"),
    opts,
  );
}
