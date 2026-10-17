import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalAction, env } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { operationRefFields } from "../../sellerCosts/workflow/validators";
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
    const decision = await ctx.runMutation(
      anyApi.settlement.workflow.mutations.authorizeProvider,
      ref,
    );
    const job = await ctx.runQuery(
      anyApi.sellerCosts.workflow.queries.owned,
      ref,
    );
    if (job.groupKey !== groupKey)
      throw new Error("Original settlement group changed.");
    if (decision === "hold")
      return {
        ...args,
        sourceId: job.sourceId,
        status: "unknown",
        reason: "provider_outcome_unknown",
      };
    return stripe.costRecovery.executeGroupProvider(
      ctx,
      { ...ref, groupKey, phase, providerApiVersion, definitionVersion },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
  },
});
