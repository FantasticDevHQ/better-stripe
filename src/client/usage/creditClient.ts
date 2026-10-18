import {
  cancelCreditPurchase,
  prepareCreditRefund,
} from "./creditLifecycle.js";
import { reconcileCreditPurchase } from "./creditReconciliation.js";
import Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { componentRef } from "../webhooks/helpers.js";
import { UsageSubscriptionClient } from "./subscriptionClient.js";
import { prepareUsageRecord, scopeSchema, type UsageScope } from "./records.js";
import type { UsageSubscriptionBinding } from "./boundaries.js";
import {
  creditBinding,
  UsageCreditError,
  type UsageCreditBinding,
  type UsageCreditPurchaseOptions,
  type UsageCreditBalance,
} from "./creditTerms.js";
import {
  ensureCreditPurchase,
  observeCreditPurchase,
  creditPurchaseView,
} from "./creditProvider.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import type { Doc, Id } from "../../component/_generated/dataModel.js";
import { z } from "zod";
const provider = (
  input: UsageCreditBinding,
  options: UsageDeliveryProviderOptions,
) => {
  if (!options.stripeSecretKey)
    throw new UsageCreditError(
      "provider_unavailable",
      "Native usage credit credentials unavailable",
    );
  return new Stripe(options.stripeSecretKey, {
    apiVersion: creditBinding(input).binding.apiVersion as StripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 15000,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
};
async function operation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UsageCreditError) throw error;
    throw new UsageCreditError(
      error instanceof Error && /insufficient/i.test(error.message)
        ? "insufficient_credits"
        : "reconciliation_required",
      "Usage credit operation could not complete",
    );
  }
}
/** Trusted host authorizes the exact payer/realm/meter, activity and original terms. */
export class UsageCreditClient extends UsageSubscriptionClient {
  reconcileCreditPurchase(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return reconcileCreditPurchase(
      provider(input, options),
      this.component,
      ctx,
      input,
    );
  }
  prepareCreditRefund(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return prepareCreditRefund(
      provider(input, options),
      this.component,
      ctx,
      input,
    );
  }
  cancelCreditPurchase(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return cancelCreditPurchase(
      provider(input, options),
      this.component,
      ctx,
      input,
    );
  }
  purchaseCredits(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return ensureCreditPurchase(
      provider(input, options),
      this.component,
      ctx,
      input,
    );
  }
  observeCreditPurchase(
    ctx: RunCtx,
    input: UsageCreditPurchaseOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return observeCreditPurchase(
      provider(input, options),
      this.component,
      ctx,
      input,
    );
  }
  async getCreditPurchase(
    ctx: RunCtx,
    input: UsageCreditBinding & { purchaseId: string },
  ) {
    const row = (await ctx.runQuery(
      componentRef(this.component, "usageCredits/queries/getPurchase"),
      {
        bindingJson: JSON.stringify(creditBinding(input)),
        purchaseId: input.purchaseId,
      },
    )) as Doc<"usageCreditPurchases"> | null;
    return row ? creditPurchaseView(row) : null;
  }
  resumeCreditAccount(ctx: RunCtx, input: UsageCreditBinding) {
    return operation(() =>
      runMutationOrThrow(
        ctx,
        componentRef(this.component, "usageCredits/mutations/resumeAccount"),
        {
          bindingJson: JSON.stringify(creditBinding(input)),
        },
      ),
    );
  }
  closeCreditAccount(ctx: RunCtx, input: UsageCreditBinding) {
    return operation(() =>
      runMutationOrThrow(
        ctx,
        componentRef(this.component, "usageCredits/mutations/closeAccount"),
        {
          bindingJson: JSON.stringify(creditBinding(input)),
        },
      ),
    );
  }
  getCreditBalance(
    ctx: RunCtx,
    input: UsageCreditBinding,
  ): Promise<UsageCreditBalance> {
    return ctx.runQuery(
      componentRef(this.component, "usageCredits/queries/balance"),
      { bindingJson: JSON.stringify(creditBinding(input)) },
    );
  }
  reserveCredits(
    ctx: RunCtx,
    input: { event: unknown; subscription: UsageSubscriptionBinding },
  ): Promise<{
    reservationId: Id<"usageReservations">;
    state: "reserved" | "committed" | "released";
  }> {
    const event = prepareUsageRecord(input.event);
    const original = {
      scope: event.scope,
      binding: event.binding,
      quantity: event.quantity,
      sourceEventId: event.sourceEventId,
      occurredAt: event.occurredAt,
    };
    return operation(() =>
      runMutationOrThrow(
        ctx,
        componentRef(this.component, "usageCredits/mutations/reserve"),
        {
          inputJson: JSON.stringify(original),
          subscriptionJson: JSON.stringify(input.subscription),
        },
      ),
    );
  }
  releaseCredits(
    ctx: RunCtx,
    input: {
      scope: UsageScope;
      reservationId: Id<"usageReservations">;
      reason: "work_failed" | "abandoned_before_work";
    },
  ) {
    return operation(() =>
      runMutationOrThrow(
        ctx,
        componentRef(this.component, "usageCredits/mutations/release"),
        {
          scope: scopeSchema.parse(input.scope),
          reservationId: input.reservationId,
          reason: input.reason,
        },
      ),
    );
  }
  readCreditHistory(
    ctx: RunCtx,
    input: UsageCreditBinding & { limit: number; cursor: string | null },
  ) {
    return this.creditPage<Doc<"usageCreditHistory">>(
      ctx,
      "readHistory",
      input,
    );
  }
  readCreditGrants(
    ctx: RunCtx,
    input: UsageCreditBinding & { limit: number; cursor: string | null },
  ) {
    return this.creditPage<Doc<"usageCreditGrants">>(ctx, "readGrants", input);
  }
  private async creditPage<T>(
    ctx: RunCtx,
    name: string,
    input: UsageCreditBinding & { limit: number; cursor: string | null },
  ) {
    const limit = z.number().int().min(1).max(100).parse(input.limit);
    const cursor = z.string().max(2048).nullable().parse(input.cursor);
    const result = (await ctx.runQuery(
      componentRef(this.component, "usageCredits/queries/" + name),
      {
        bindingJson: JSON.stringify(creditBinding(input)),
        paginationOpts: { numItems: limit, cursor },
      },
    )) as { page: T[]; isDone: boolean; continueCursor: string };
    return {
      records: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  }
}
