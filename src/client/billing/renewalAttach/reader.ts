import { z } from "zod";
import type Stripe from "stripe";
import {
  renewalExpected,
  renewalSubscription,
  renewalPrice,
  renewalBillingCustomer,
} from "../renewalReplacementSchema.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  productId,
  referenceId,
  resourceId,
  supportedVersion,
  unsupported,
  timestamp,
} from "../renewalAggregate/shared.js";
import { joinRenewalCoupons } from "./couponJoins.js";

const input = z.object({ expected: renewalExpected }).strict();
export type ReadRenewalPriceReplacementContextOptions = z.infer<typeof input>;
const observedSchedule = z.union([
  z.null(),
  resourceId("sub_sched"),
  z
    .object({
      id: resourceId("sub_sched"),
      object: z.literal("subscription_schedule"),
      deleted: z.literal(false).optional(),
    })
    .passthrough(),
]);
const readSubscription = renewalSubscription.extend({
  schedule: observedSchedule,
});
/** Fixed provider read profile. Evidence acquisition is not write qualification. */
export async function readRenewalPriceReplacementContext(
  stripe: Stripe,
  options: ReadRenewalPriceReplacementContextOptions,
  apiVersion: string,
) {
  const args = input.parse(renewalSnapshot(options));
  supportedVersion(apiVersion);
  const expected = args.expected;
  const requestOptions = {
    apiVersion: "2026-09-30.endive" as const,
    maxNetworkRetries: 0,
  };
  const subscription = readSubscription.parse(
    renewalSnapshot(
      await stripe.subscriptions.retrieve(
        expected.subscriptionId,
        { expand: ["discounts", "items.data.discounts", "items.data.price"] },
        requestOptions,
      ),
    ),
  );
  const item = subscription.items.data[0];
  const context = {
    customerAccountId: expected.customerAccountId,
    livemode: expected.livemode,
  };
  if (
    subscription.id !== expected.subscriptionId ||
    subscription.customer_account !== expected.customerAccountId ||
    subscription.livemode !== expected.livemode ||
    item.id !== expected.itemId ||
    item.subscription !== expected.subscriptionId ||
    item.price.id !== expected.currentPriceId ||
    item.price.livemode !== expected.livemode ||
    productId(item.price.product, context) !== expected.currentProductId ||
    item.current_period_start !== expected.periodStart ||
    item.current_period_end !== expected.periodEnd
  )
    unsupported("original_read_identity_mismatch");
  const targetPrice = renewalPrice.parse(
    renewalSnapshot(
      await stripe.prices.retrieve(expected.targetPriceId, {}, requestOptions),
    ),
  );
  if (
    targetPrice.id !== expected.targetPriceId ||
    targetPrice.livemode !== expected.livemode ||
    productId(targetPrice.product, context) !== expected.targetProductId
  )
    unsupported("target_read_identity_mismatch");
  const customerId = referenceId(
    subscription.customer,
    "cus",
    "customer",
    context,
  );
  const billingCustomer = renewalBillingCustomer.parse(
    renewalSnapshot(
      await stripe.customers.retrieve(customerId, {}, requestOptions),
    ),
  );
  if (
    billingCustomer.id !== customerId ||
    billingCustomer.customer_account !== expected.customerAccountId ||
    billingCustomer.livemode !== expected.livemode
  )
    unsupported("billing_customer_identity_mismatch");
  const joined = await joinRenewalCoupons(
    stripe,
    subscription,
    item,
    expected.livemode,
    requestOptions,
  );
  const normalizedSubscription = {
    ...subscription,
    discounts: joined.subscriptionDiscounts,
    items: {
      ...subscription.items,
      data: [{ ...item, discounts: joined.itemDiscounts }],
    },
  };
  const observedAt = timestamp.parse(Math.floor(Date.now() / 1000));
  return renewalSnapshot({
    version: 1 as const,
    scope: "platform" as const,
    apiVersion,
    readProfile: "renewal-context-v1" as const,
    providerQualification: "required" as const,
    observedAt,
    subscription: normalizedSubscription,
    targetPrice,
    billingCustomer,
  });
}
