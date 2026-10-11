import type Stripe from "stripe";

import { validateSplit } from "../core/fees.js";
import type { SplitRecipient } from "../../component/lib/fees.js";

/** Recover routing from Stripe for both webhook delivery and explicit syncs. */
export function subscriptionRouting(subscription: Stripe.Subscription) {
  const destination = subscription.transfer_data?.destination;
  if (destination) {
    return {
      chargeType: "destination" as const,
      destinationAccountId:
        typeof destination === "string" ? destination : destination.id,
      applicationFeePercent: subscription.application_fee_percent ?? undefined,
    };
  }
  if (subscription.metadata?.bsChargeType === "separate") {
    const split = JSON.parse(
      subscription.metadata.bsSplit ?? "null",
    ) as SplitRecipient[];
    validateSplit(split);
    return { chargeType: "separate" as const, splitRecipients: split };
  }
  return {};
}
