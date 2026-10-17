import { components } from "../../_generated/api";
import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalAction, env } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { operationRefFields } from "./validators";
/** Credentials exist only in this internal action; the package closes the receipt before journaling. */
export const observe = internalAction({
  args: {
    ...operationRefFields,
    providerApiVersion: v.string(),
    definitionVersion: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { accountId, scopeKey, currency, operationId, version } = args;
    const ref = { accountId, scopeKey, currency, operationId, version };
    const job = await ctx.runQuery(
      anyApi.sellerCosts.workflow.queries.owned,
      ref,
    );
    const receipt = await stripe.costRecovery.observeProcessingCosts(
      ctx,
      args,
      {
        stripeSecretKey: env.STRIPE_SECRET_KEY,
      },
    );
    if (receipt.outcome.status === "ready" && !job.groupKey) {
      const proof = receipt.outcome.value.provenance;
      if (!proof.stripePriceId || !proof.stripeProductId)
        return {
          ...receipt,
          outcome: {
            status: "rejected" as const,
            reason: "unsupported_source" as const,
            retryable: false as const,
          },
        };
      const price = await ctx.runQuery(
        components.betterStripe.products.queries.getPriceByStripeId,
        { stripePriceId: proof.stripePriceId },
      );
      const product = await ctx.runQuery(
        components.betterStripe.products.queries.getProductByStripeId,
        { stripeProductId: proof.stripeProductId },
      );
      if (!price || !product)
        return {
          ...receipt,
          outcome: {
            status: "unknown" as const,
            reason: "history_incomplete" as const,
            retryable: false as const,
          },
        };
      if (
        price.stripeProductId !== proof.stripeProductId ||
        product.accountId !== job.accountId ||
        price.currency !== job.currency
      )
        return {
          ...receipt,
          outcome: {
            status: "conflict" as const,
            reason: "identity_changed" as const,
            retryable: false as const,
          },
        };
    }
    return receipt;
  },
});
