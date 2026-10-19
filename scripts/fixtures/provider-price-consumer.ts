import type { FunctionArgs } from "convex/server";
import type { ComponentApi } from "@fantastic.dev/better-stripe/_generated/component.js";
import {
  BetterStripe,
  type StripeComponentPrice,
} from "@fantastic.dev/better-stripe";

export async function readProviderPrices(
  client: BetterStripe,
  ctx: Parameters<BetterStripe["paginatePrices"]>[0],
) {
  const result = await client.paginatePrices(ctx, {
    stripeProductId: "prod_selected",
    paginationOpts: { numItems: 100, cursor: null },
  });
  const rows: StripeComponentPrice[] = result.page;
  return { rows, continueCursor: result.continueCursor, isDone: result.isDone };
}

// Genuine generated component types must expose the same additive selector.
export const providerComponentArgs: FunctionArgs<
  ComponentApi["products"]["queries"]["paginatePrices"]
> = {
  stripeProductId: "prod_selected",
  paginationOpts: { numItems: 100, cursor: null },
};
