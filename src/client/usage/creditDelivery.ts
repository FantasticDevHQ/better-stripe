import { runMutationOrThrow } from "../helpers.js";
import { UsageCreditRecoveryError } from "./creditTerms.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { PreparedUsageRecord } from "./records.js";
import { creditNativeObservation } from "./creditProofs.js";
import { creditPurchaseTerms } from "./creditTerms.js";
import {
  creditRequire,
  paymentIdentity,
  verifiedCreditPayment,
} from "./creditNative.js";
export async function verifyCreditDelivery(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  event: Doc<"usageEvents">,
  record: PreparedUsageRecord,
) {
  if (record.binding.plan.model !== "prepaid") return;
  const saved = (await ctx.runQuery(
    componentRef(component, "usageCredits/queries/deliveryBacking"),
    {
      scope: record.scope,
      eventId: event._id,
    },
  )) as {
    held: boolean;
    purchases: Doc<"usageCreditPurchases">[];
    grants: Doc<"usageCreditGrants">[];
  };
  creditRequire(
    !saved.held && saved.grants.length > 0 && saved.grants.length <= 10,
    "Credit delivery backing held",
  );
  for (let index = 0; index < saved.grants.length; index++) {
    const local = saved.grants[index],
      purchase = saved.purchases[index],
      terms = creditPurchaseTerms(JSON.parse(purchase.termsJson));
    const [grant, payment, summary] = await Promise.all([
      stripe.billing.creditGrants.retrieve(local.creditGrantId),
      stripe.paymentIntents.retrieve(local.paymentIntentId, {
        expand: ["latest_charge"],
      }),
      stripe.billing.creditBalanceSummaries.retrieve({
        customer_account: record.scope.customerAccount,
        filter: { type: "credit_grant", credit_grant: local.creditGrantId },
      }),
    ]);
    paymentIdentity(payment, terms, purchase.key, local.paymentIntentId);
    try {
      creditRequire(
        verifiedCreditPayment(payment, terms),
        "Credit payment no longer verified",
      );
    } catch (error) {
      if (error instanceof UsageCreditRecoveryError)
        await runMutationOrThrow(
          ctx,
          componentRef(component, "usageCredits/mutations/freezePurchase"),
          {
            key: purchase.key,
            paymentIntentId: local.paymentIntentId,
            reason: error.reason,
            refundedAmount:
              typeof payment.latest_charge === "object"
                ? payment.latest_charge?.amount_refunded
                : undefined,
          },
        );
      throw error;
    }
    const native = summary.balances[0]?.ledger_balance.monetary;
    const available = summary.balances[0]?.available_balance.monetary;
    const last = local.nativeObservationJson
      ? creditNativeObservation.parse(JSON.parse(local.nativeObservationJson))
      : null;
    // A changed balance requires invoice/source reconciliation before a new send.
    // Grant creation is the initial authoritative funding observation.
    const expected = last?.ledgerAmount ?? terms.amount;
    creditRequire(
      grant.id === local.creditGrantId &&
        !grant.voided_at &&
        grant.customer_account === record.scope.customerAccount &&
        grant.livemode === record.scope.livemode &&
        grant.metadata?.bsUsageCredit === purchase.key &&
        (grant.expires_at === null ||
          grant.expires_at >
            JSON.parse(event.subscriptionJson).period.end + 72 * 3600) &&
        grant.applicability_config.scope.prices?.length === 1 &&
        grant.applicability_config.scope.prices[0].id ===
          record.binding.stripePriceId &&
        summary.livemode === record.scope.livemode &&
        summary.customer_account === record.scope.customerAccount &&
        summary.balances.length === 1 &&
        native?.currency === terms.binding.plan.rate.currency &&
        native.value === expected &&
        available?.currency === native.currency &&
        available.value === native.value,
      "Credit delivery requires current native backing reconciliation",
    );
  }
}
