import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import {
  subscriptionTerms,
  subscriptionEvidence,
  subscriptionView,
  type UsageSubscriptionView,
} from "./subscriptionTerms.js";
import {
  subscriptionCall,
  UsageSubscriptionError,
  verifySubscriptionRealm,
} from "./subscriptionProvider.js";
export async function changeManagedCancellation(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageSubscriptionIntents">,
  input: { operationId: string; cancelAtPeriodEnd: boolean },
): Promise<UsageSubscriptionView> {
  const terms = subscriptionTerms(JSON.parse(row.termsJson)),
    startedAt = Date.now();
  return subscriptionCall(async () => {
    if (!row.providerId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Managed subscription not observed",
      );
    await verifySubscriptionRealm(stripe, terms);
    const command = (await runMutationOrThrow(
      ctx,
      componentRef(
        component,
        "usageSubscriptions/mutations/prepareCancellation",
      ),
      { key: row.key, ...input },
    )) as Doc<"usageSubscriptionControls">;
    const resultView = (json: string) => {
      const view = JSON.parse(json) as UsageSubscriptionView;
      if (
        !input.cancelAtPeriodEnd &&
        ["canceled", "incomplete_expired"].includes(view.status)
      )
        throw new UsageSubscriptionError(
          "incompatible_terms",
          "A canceled native subscription cannot be reactivated",
        );
      return view;
    };
    if (command.resultJson) return resultView(command.resultJson);
    let native = await stripe.subscriptions.retrieve(row.providerId);
    if (native.id !== row.providerId)
      throw new UsageSubscriptionError(
        "incompatible_terms",
        "Pinned subscription identity changed",
      );
    subscriptionView(native, terms);
    if (
      native.cancel_at_period_end !== input.cancelAtPeriodEnd &&
      !["canceled", "incomplete_expired"].includes(native.status)
    ) {
      if (Date.now() / 1000 - command.firstAttemptAt >= 23 * 3600)
        throw new UsageSubscriptionError(
          "unknown_create_outcome",
          "Cancellation requires reconciliation after its safe retry window",
        );
      native = await stripe.subscriptions.update(
        row.providerId,
        { cancel_at_period_end: input.cancelAtPeriodEnd },
        { idempotencyKey: `bs_usage_cancel_${command.key}` },
      );
    }
    const result = await runMutationOrThrow(
      ctx,
      componentRef(
        component,
        "usageSubscriptions/mutations/completeCancellation",
      ),
      {
        key: command.key,
        nativeJson: JSON.stringify(subscriptionEvidence(native)),
        startedAt,
      },
    );
    return resultView(result);
  });
}
