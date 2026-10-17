import { v } from "convex/values";
import {
  financialRetryDecision,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { internalAction } from "../../../_generated/server";
import { internal, components } from "../../../_generated/api";
import { balanceStripe } from "../../stripe";
import { ownedBillingSubscription } from "../../ownership";

export const advance = internalAction({
  args: {
    requestId: v.id("storeBalanceRequests"),
    attempt: v.number(),
    retryRequested: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (
      !Number.isSafeInteger(args.attempt) ||
      args.attempt < 0 ||
      args.attempt > 20
    )
      throw new Error("Invalid funding observation attempt.");
    const refs = internal.storeBalance.workflow.internal;
    const request = await ctx.runQuery(refs.requests.read, {
      requestId: args.requestId,
    });
    if (
      !request ||
      request.state === "finished" ||
      (request.state === "held" && !args.retryRequested)
    )
      return null;
    const hold = () =>
      ctx.runMutation(refs.requests.hold, { requestId: request._id });
    const poll = async (reconciling = false) => {
      const decision = financialRetryDecision(
        { status: "not_ready", reason: "provider_pending", retryable: true },
        args.attempt,
        { maxRetries: 20, initialDelayMs: 1000, maxDelayMs: 30000 },
      );
      if (decision.status === "stop") return hold();
      await ctx.scheduler.runAfter(decision.delayMs, refs.actions.advance, {
        requestId: request._id,
        attempt: decision.nextAttempt,
        retryRequested: reconciling,
      });
      return null;
    };
    const scope = {
      accountId: request.accountId,
      scopeKey: request.scopeKey,
      stripeSubscriptionId: request.subscriptionId,
    };
    const key = `example_balance_request_${request._id}`;
    const workflow = balanceStripe.balanceFundingWorkflow;
    try {
      const { seller, sub } = await ownedBillingSubscription(
        ctx,
        request.sellerId,
      );
      if (
        seller.stripeAccountId !== request.accountId ||
        sub.id !== request.subscriptionId
      )
        return hold();
      let saved = await ctx.runQuery(
        components.betterStripe.balanceFunding.queries.readScopePreparation,
        {
          ...scope,
          providerApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
        },
      );
      if (saved && "status" in saved) return hold();
      if (!saved?.verified) {
        if (!request.enabled) return hold();
        const preparing = await workflow.prepare(ctx, {
          ...scope,
          requestKey: `${key}:prepare`,
          consent: true,
          consentAt: request.consentAt,
          consentReference: `example-consent:${request._id}`,
          providerAction: refs.provider.execute,
        });
        if (preparing.status !== "accepted") return hold();
        await ctx.runMutation(refs.requests.bind, {
          requestId: request._id,
          operation: { ...preparing.operation, kind: "prepare" },
        });
        const prepared = await ctx.runQuery(
          components.betterStripe.balanceFunding.queries.getPreparation,
          {
            ...preparing.operation,
            stripeSubscriptionId: request.subscriptionId,
          },
        );
        if (
          !prepared ||
          !["prepared", "pending", "running", "unknown"].includes(
            prepared.status,
          )
        )
          return hold();
        if (prepared.status === "unknown") {
          if (!args.retryRequested) return hold();
          const resumed = await workflow.resume(ctx, {
            ...preparing.operation,
            stripeSubscriptionId: request.subscriptionId,
          });
          if (resumed.status !== "accepted") return hold();
          return poll(true);
        }
        if (prepared.status !== "prepared") return poll();
        saved = await ctx.runQuery(
          components.betterStripe.balanceFunding.queries.readPreparation,
          {
            ...scope,
            preparationId: prepared.preparationId,
          },
        );
      }
      if (!saved || "status" in saved || !saved.verified) return hold();
      const applied = await workflow.apply(ctx, {
        ...scope,
        preparationId: saved._id,
        enabled: request.enabled,
        ...(request.enabled ? { consent: true as const } : {}),
        requestKey: `${key}:apply`,
        providerAction: refs.provider.execute,
      });
      if (applied.status === "unchanged")
        return ctx.runMutation(refs.requests.complete, {
          requestId: request._id,
        });
      if (applied.status !== "accepted") return hold();
      await ctx.runMutation(refs.requests.bind, {
        requestId: request._id,
        operation: { ...applied.operation, kind: "apply" },
      });
      const state = await workflow.inspect(ctx, {
        ...applied.operation,
        stripeSubscriptionId: request.subscriptionId,
      });
      if (state?.state === "succeeded")
        return ctx.runMutation(refs.requests.complete, {
          requestId: request._id,
        });
      if (state?.state === "pending" || state?.state === "running")
        return poll();
      if (state?.state === "unknown" && args.retryRequested) {
        const resumed = await workflow.resume(ctx, {
          ...applied.operation,
          stripeSubscriptionId: request.subscriptionId,
        });
        if (resumed.status === "accepted") return poll(true);
      }
      return hold();
    } catch {
      // Keep the same request reference; never journal raw provider/host errors.
      return hold();
    }
  },
});
