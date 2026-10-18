import type Stripe from "stripe";
import type { UsageCreditPurchaseTerms } from "./creditTerms.js";
import { UsageCreditError, UsageCreditRecoveryError } from "./creditTerms.js";
import { verifyRealm } from "./catalogTypes.js";
import { verifyPinnedUsagePrice } from "./catalogPrices.js";
import { paymentCreditProof } from "./creditProofs.js";
export const nativeCustomerId = (
  value: string | { id: string } | null | undefined,
) => (typeof value === "string" ? value : value?.id);
export async function creditCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof UsageCreditError) throw error;
    throw new UsageCreditError(
      "provider_unavailable",
      "Native usage credits unavailable",
    );
  }
}
export function creditRequire(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition)
    throw new UsageCreditError("reconciliation_required", message);
}
export async function verifyCreditRealm(
  stripe: Stripe,
  terms: UsageCreditPurchaseTerms,
  checkPrice = true,
) {
  const scope = {
    stripeAccountId: terms.scope.stripeAccountId,
    livemode: terms.scope.livemode,
  };
  await verifyRealm(stripe, scope);
  const customer = await stripe.customers.retrieve(terms.scope.customerAccount);
  creditRequire(
    !customer.deleted &&
      customer.id === terms.binding.stripeCustomerId &&
      customer.customer_account === terms.scope.customerAccount &&
      customer.livemode === terms.scope.livemode,
    "Native credit customer scope mismatch",
  );
  if (!checkPrice) return;
  const price = await stripe.prices.retrieve(terms.binding.stripePriceId, {
    expand: ["tiers"],
  });
  creditRequire(
    price.id === terms.binding.stripePriceId,
    "Native credit price identity mismatch",
  );
  verifyPinnedUsagePrice(price, scope, terms.binding.plan, terms.scope.meterId);
}
export function paymentIdentity(
  payment: Stripe.PaymentIntent,
  terms: UsageCreditPurchaseTerms,
  key: string,
  pinned?: string,
) {
  creditRequire(
    payment.object === "payment_intent" &&
      (!pinned || payment.id === pinned) &&
      payment.customer_account === terms.scope.customerAccount &&
      nativeCustomerId(payment.customer) === terms.binding.stripeCustomerId &&
      payment.livemode === terms.scope.livemode &&
      payment.currency === terms.binding.plan.rate.currency &&
      payment.amount === terms.amount &&
      payment.metadata.bsUsageCredit === key &&
      !payment.transfer_data &&
      !payment.on_behalf_of &&
      !payment.application_fee_amount,
    "Native credit payment scope or identity mismatch",
  );
}
export function verifiedCreditPayment(
  payment: Stripe.PaymentIntent,
  terms: UsageCreditPurchaseTerms,
) {
  if (payment.status !== "succeeded") return null;
  const charge = payment.latest_charge;
  creditRequire(
    payment.amount_received === terms.amount &&
      charge &&
      typeof charge !== "string" &&
      charge.object === "charge" &&
      charge.payment_intent === payment.id &&
      nativeCustomerId(charge.customer) === terms.binding.stripeCustomerId &&
      charge.paid &&
      charge.captured &&
      charge.status === "succeeded" &&
      charge.amount === terms.amount &&
      charge.amount_captured === terms.amount &&
      charge.currency === terms.binding.plan.rate.currency &&
      charge.livemode === terms.scope.livemode,
    "Credit payment success is not verified",
  );
  if (charge.disputed || charge.refunded || charge.amount_refunded !== 0)
    throw new UsageCreditRecoveryError(
      charge.disputed ? "payment_disputed" : "payment_refunded",
    );
  return paymentCreditProof.parse({
    paymentIntentId: payment.id,
    chargeId: charge.id,
    amount: terms.amount,
    currency: payment.currency,
    customerAccount: terms.scope.customerAccount,
    livemode: terms.scope.livemode,
  });
}
export function creditCreateWindow(firstAttemptAt: number) {
  if (Date.now() / 1000 - firstAttemptAt >= 23 * 3600)
    throw new UsageCreditError(
      "unknown_create_outcome",
      "Native credit creation requires reconciliation after its safe retry window",
    );
}
export async function discoverCredit<
  T extends { id: string; metadata: Stripe.Metadata | null },
>(
  key: string,
  list: (cursor?: string) => Promise<Stripe.ApiList<T>>,
): Promise<T | null> {
  let cursor: string | undefined,
    found: T | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await list(cursor);
    creditRequire(
      result.data.length <= 100,
      "Native credit discovery incomplete",
    );
    for (const row of result.data) {
      if (row.metadata?.bsUsageCredit !== key) continue;
      creditRequire(
        !found || found.id === row.id,
        "Ambiguous native credit identity",
      );
      found = row;
    }
    if (!result.has_more) return found;
    const next = result.data[result.data.length - 1]?.id;
    creditRequire(
      next && next !== cursor,
      "Native credit discovery incomplete",
    );
    cursor = next;
  }
  throw new UsageCreditError(
    "reconciliation_required",
    "Native credit discovery incomplete",
  );
}
