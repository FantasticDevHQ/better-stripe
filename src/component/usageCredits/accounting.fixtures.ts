import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCredits/mutations:${name}`);
const prepare = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:prepare",
);
const save = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:save",
);
export async function setupCredits() {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  const meter = {
    scope: request.meters[0].scope,
    binding: {
      ...request.meters[0].binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "prepaid",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
        insufficientBalance: "reject",
      } as const,
    },
  };
  const terms = { ...request, meters: [meter] };
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(nativeSubscription()),
    startedAt: Date.now(),
  });
  const purchase = {
    ...meter,
    purchaseId: "topup1",
    quantity: "10",
    ownership: "issuer",
    rollover: "retain_original_terms",
  };
  const row = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify(purchase),
  });
  await t.mutation(ref("pinPayment"), {
    key: row.key,
    paymentIntentId: "pi_topup1",
  });
  const proof = {
    paymentIntentId: "pi_topup1",
    chargeId: "ch_topup1",
    amount: 20,
    currency: "usd",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  await t.mutation(ref("verifyPayment"), {
    key: row.key,
    proofJson: JSON.stringify(proof),
  });
  await t.mutation(ref("pinGrant"), {
    key: row.key,
    proofJson: JSON.stringify({
      ...proof,
      creditGrantId: "credgr_topup1",
      stripePriceId: "price_calls",
      createdAt: 700,
      effectiveAt: 700,
      expiresAt: null,
    }),
  });
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  };
  const event = {
    ...meter,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  return { t, meter, purchase, row, proof, subscription, event };
}
