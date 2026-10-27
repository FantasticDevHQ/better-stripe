import { idempotencyOptions } from "../core/idempotency.js";
import {
  renewalExpected,
  renewalBillingCustomer,
  renewalPreparationInput,
  renewalPrice,
  renewalSubscription,
  type RenewalPriceReplacementExpected,
} from "./renewalReplacementSchema.js";
import { renewalSnapshot } from "./renewalReplacementSnapshot.js";

export type PrepareRenewalPriceReplacementOptions = {
  subscription: unknown;
  targetPrice: unknown;
  billingCustomer?: unknown;
  expected: RenewalPriceReplacementExpected;
  key: string;
};

/**
 * Pure read qualification, not write authorization or proof of preservation.
 * Supply fresh full provider reads on the trusted server. Persist the result
 * under host-owned immutable authorization before any later dispatch.
 */
export function prepareRenewalPriceReplacement(
  options: PrepareRenewalPriceReplacementOptions,
) {
  const args = renewalPreparationInput.parse(renewalSnapshot(options));
  const key = idempotencyOptions(args.key)?.idempotencyKey;
  if (!key) throw new Error("Renewal preparation requires an explicit key.");
  const expected = renewalExpected.parse(args.expected);
  const source = renewalSnapshot({
    subscription: args.subscription,
    targetPrice: args.targetPrice,
  });
  const subscription = renewalSubscription.parse(source.subscription);
  const targetPrice = renewalPrice.parse(source.targetPrice);
  const billingCustomer =
    args.billingCustomer === undefined
      ? undefined
      : renewalBillingCustomer.parse(args.billingCustomer);
  if (billingCustomer !== undefined) {
    const reference = subscription.customer;
    const referenceId =
      typeof reference === "string"
        ? reference
        : typeof reference === "object" &&
            reference !== null &&
            "id" in reference &&
            "object" in reference &&
            reference.object === "customer" &&
            !("deleted" in reference && reference.deleted === true)
          ? reference.id
          : undefined;
    if (
      referenceId !== billingCustomer.id ||
      billingCustomer.customer_account !== expected.customerAccountId ||
      billingCustomer.livemode !== expected.livemode
    )
      throw new Error(
        "Billing customer evidence does not match the original subscription account.",
      );
  }
  const item = subscription.items.data[0];
  const current = item.price;
  const productId = (p: typeof current.product) =>
    typeof p === "string" ? p : p.id;
  if (
    subscription.id !== expected.subscriptionId ||
    subscription.customer_account !== expected.customerAccountId ||
    item.subscription !== expected.subscriptionId ||
    item.id !== expected.itemId ||
    current.id !== expected.currentPriceId ||
    productId(current.product) !== expected.currentProductId ||
    targetPrice.id !== expected.targetPriceId ||
    productId(targetPrice.product) !== expected.targetProductId ||
    item.current_period_start !== expected.periodStart ||
    item.current_period_end !== expected.periodEnd ||
    [subscription.livemode, current.livemode, targetPrice.livemode].some(
      (mode) => mode !== expected.livemode,
    )
  )
    throw new Error(
      "Renewal replacement does not match the authorized original and target.",
    );
  if (
    !targetPrice.active ||
    current.id === targetPrice.id ||
    subscription.currency !== current.currency ||
    current.currency !== targetPrice.currency
  )
    throw new Error(
      "The target must be a different active recurring price in the original subscription currency; alternative currency_options require separate validation.",
    );
  for (const field of [
    "pending_invoice_item_interval",
    "pending_setup_intent",
    "pause_schedules",
  ])
    if (subscription[field] != null)
      throw new Error(`Renewal replacement does not support ${field}.`);
  const providerSnapshot = renewalSnapshot({
    subscription,
    targetPrice,
    ...(billingCustomer === undefined ? {} : { billingCustomer }),
  });
  const bound = {
    version: 1 as const,
    scope: "platform" as const,
    expected,
    quantity: item.quantity,
    providerSnapshot,
  };
  return {
    ...bound,
    status: "prepared" as const,
    preservation: "requires_schedule_validation" as const,
    requestIdentity: {
      key,
      binding: `renewal:v1:${JSON.stringify(renewalSnapshot(bound))}`,
    },
  };
}

export type PreparedRenewalPriceReplacement = ReturnType<
  typeof prepareRenewalPriceReplacement
>;
