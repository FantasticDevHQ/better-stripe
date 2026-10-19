import {
  BetterStripe,
  type ProductIdentityResult,
  type PriceIdentityResult,
  type StripeComponentProduct,
  type StripeComponentPrice,
} from "@fantastic.dev/better-stripe";

export async function readCatalog(
  client: BetterStripe,
  ctx: Parameters<BetterStripe["getProductIdentity"]>[0],
) {
  const product: ProductIdentityResult = await client.getProductIdentity(ctx, {
    stripeProductId: "prod_original",
  });
  const price: PriceIdentityResult = await client.getPriceIdentity(ctx, {
    stripePriceId: "price_original",
  });
  if (product.status !== "unique" || price.status !== "unique") return null;
  const productRow: StripeComponentProduct = product.product;
  const priceRow: StripeComponentPrice = price.price;
  const componentId: string = productRow._id;
  const linkedComponentId: string = priceRow.productId;
  return { componentId, linkedComponentId };
}
