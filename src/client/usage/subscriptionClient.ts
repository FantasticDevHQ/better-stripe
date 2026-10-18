import { abandonManagedSignup } from "./subscriptionAbandonment.js";
import Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { componentRef } from "../webhooks/helpers.js";
import { UsageObservationClient } from "./observationClient.js";
import {
  ensureManagedSubscription,
  UsageSubscriptionError,
} from "./subscriptionProvider.js";
import { ensureManagedCheckout } from "./subscriptionCheckout.js";
import { changeManagedCancellation } from "./subscriptionCancellation.js";
import {
  getSubscriptionIntent,
  refreshManagedSubscription,
  observeManagedInvoice,
  retireManagedSubscription,
  type UsageSubscriptionRef,
} from "./subscriptionLifecycle.js";
import {
  subscriptionTerms,
  type UsageSubscriptionOptions,
  type UsageSubscriptionView,
} from "./subscriptionTerms.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import type { UsageAvailability } from "./boundaries.js";
import { validateUsagePageRequest } from "./boundaries.js";
import type { Doc } from "../../component/_generated/dataModel.js";
function provider(version: string, options: UsageDeliveryProviderOptions) {
  if (!options.stripeSecretKey)
    throw new UsageSubscriptionError(
      "provider_unavailable",
      "Native usage subscription credentials unavailable",
    );
  return new Stripe(options.stripeSecretKey, {
    apiVersion: version as StripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 15000,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
}
/** Trusted host authorizes the full payer/realm and every original meter first. */
export class UsageSubscriptionClient extends UsageObservationClient {
  async ensureSubscription(
    ctx: RunCtx,
    input: UsageSubscriptionOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    const terms = subscriptionTerms(input);
    return ensureManagedSubscription(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      terms,
    );
  }
  async ensureCheckout(
    ctx: RunCtx,
    input: UsageSubscriptionOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    const terms = subscriptionTerms(input);
    return ensureManagedCheckout(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      terms,
    );
  }
  async getSubscription(
    ctx: RunCtx,
    input: UsageSubscriptionRef,
  ): Promise<UsageAvailability<UsageSubscriptionView>> {
    const row = await getSubscriptionIntent(this.component, ctx, input);
    return row.viewJson && row.startedAt !== undefined
      ? {
          status: "available",
          observedAt: Math.floor(row.startedAt / 1000),
          value: JSON.parse(row.viewJson) as UsageSubscriptionView,
        }
      : {
          status: "unavailable",
          reason: "subscription_not_observed",
          retryable: true,
        };
  }
  async observeSubscription(
    ctx: RunCtx,
    input: UsageSubscriptionRef,
    options: UsageDeliveryProviderOptions,
  ) {
    const row = await getSubscriptionIntent(this.component, ctx, input),
      terms = subscriptionTerms(JSON.parse(row.termsJson));
    return refreshManagedSubscription(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      row,
    );
  }
  async setCancelAtPeriodEnd(
    ctx: RunCtx,
    input: UsageSubscriptionRef & {
      operationId: string;
      cancelAtPeriodEnd: boolean;
    },
    options: UsageDeliveryProviderOptions,
  ) {
    const row = await getSubscriptionIntent(this.component, ctx, input),
      terms = subscriptionTerms(JSON.parse(row.termsJson));
    return changeManagedCancellation(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      row,
      {
        operationId: input.operationId,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      },
    );
  }
  async observeSubscriptionInvoice(
    ctx: RunCtx,
    input: UsageSubscriptionRef & { invoiceId: string },
    options: UsageDeliveryProviderOptions,
  ) {
    const row = await getSubscriptionIntent(this.component, ctx, input),
      terms = subscriptionTerms(JSON.parse(row.termsJson));
    return observeManagedInvoice(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      row,
      input.invoiceId,
    );
  }
  async retireSubscription(
    ctx: RunCtx,
    input: UsageSubscriptionRef & { invoiceId: string },
    options: UsageDeliveryProviderOptions,
  ) {
    const row = await getSubscriptionIntent(this.component, ctx, input),
      terms = subscriptionTerms(JSON.parse(row.termsJson));
    return retireManagedSubscription(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      row,
      input.invoiceId,
    );
  }
  async abandonSignup(
    ctx: RunCtx,
    input: UsageSubscriptionRef,
    options: UsageDeliveryProviderOptions,
  ) {
    const row = await getSubscriptionIntent(this.component, ctx, input),
      terms = subscriptionTerms(JSON.parse(row.termsJson));
    return abandonManagedSignup(
      provider(terms.meters[0].binding.apiVersion, options),
      this.component,
      ctx,
      row,
    );
  }
  async readSubscriptionHistory(
    ctx: RunCtx,
    input: UsageSubscriptionRef & {
      kind: "subscription" | "invoice" | "retirement";
      limit: number;
      cursor: string | null;
    },
  ) {
    const page = validateUsagePageRequest({
      period: { start: 0, end: 1 },
      limit: input.limit,
      cursor: input.cursor,
    });
    await getSubscriptionIntent(this.component, ctx, input);
    const result = (await ctx.runQuery(
      componentRef(this.component, "usageSubscriptions/queries/history"),
      {
        scope: input.scope,
        requestId: input.requestId,
        kind: input.kind,
        paginationOpts: { numItems: page.limit, cursor: page.cursor },
      },
    )) as {
      page: Doc<"usageSubscriptionHistory">[];
      isDone: boolean;
      continueCursor: string;
    };
    return {
      records: result.page.map((row) => ({
        kind: row.kind,
        resourceId: row.resourceId,
        observedAt: Math.floor(row.startedAt / 1000),
        observation: JSON.parse(row.observationJson) as unknown,
      })),
      isDone: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  }
}
