import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalAction, env } from "../../../_generated/server";
import { stripe } from "../../../stripe/helpers";
import { operationRefFields } from "../../workflow/validators";
export const execute = internalAction({
  args: {
    ...operationRefFields,
    groupKey: v.string(),
    phase: v.union(v.literal("execute"), v.literal("reconcile")),
    providerApiVersion: v.string(),
    definitionVersion: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { groupKey, phase, providerApiVersion, definitionVersion, ...ref } =
      args;
    const job = await ctx.runQuery(
      anyApi.sellerCosts.workflow.queries.owned,
      ref,
    );
    if (job.kind !== "invoice" || job.groupKey !== groupKey)
      throw new Error("Original recovery invoice operation changed.");
    return stripe.costRecovery.executeGroupProvider(
      ctx,
      { ...ref, groupKey, phase, providerApiVersion, definitionVersion },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
  },
});
