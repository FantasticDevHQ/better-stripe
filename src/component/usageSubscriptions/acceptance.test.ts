import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const prepare = makeFunctionReference<"mutation">(
    "usageSubscriptions/mutations:prepare",
  ),
  save = makeFunctionReference<"mutation">("usageSubscriptions/mutations:save"),
  record = makeFunctionReference<"mutation">("usage/mutations:record");
afterEach(() => vi.useRealTimers());
it("rejects new managed usage at closeout while retaining immutable replays", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(request),
    method: "direct",
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(nativeSubscription()),
    startedAt: Date.now(),
  });
  const input = {
    ...request.meters[0],
    sourceEventId: "one",
    quantity: "1",
    occurredAt: 700,
  };
  const sub = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  };
  const args = {
    inputJson: JSON.stringify(input),
    subscriptionJson: JSON.stringify(sub),
  };
  const receipt = await t.mutation(record, args);
  vi.setSystemTime(1150000);
  expect(await t.mutation(record, args)).toEqual(receipt);
  await expect(
    t.mutation(record, {
      ...args,
      inputJson: JSON.stringify({
        ...input,
        sourceEventId: "late",
        occurredAt: 1100,
      }),
    }),
  ).rejects.toThrow(/closing|closed/i);
});

it("keeps enrollment reserved until native cancellation/finalization and all local sends are resolved", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules),
    intent = await t.mutation(prepare, {
      termsJson: JSON.stringify(request),
      method: "direct",
    });
  const native = nativeSubscription();
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  const retire = makeFunctionReference<"mutation">(
    "usageSubscriptions/mutations:retire",
  );
  const proof = {
    invoiceId: "in_closeout",
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    stripeCustomerId: "cus_buyer",
    livemode: false,
    subscriptionId: "sub_calls",
    status: "open",
    finalizedAt: 1300,
    billingReason: "subscription_cycle",
    periodEnd: 1200,
  };
  await expect(
    t.mutation(retire, { key: intent.key, proofJson: JSON.stringify(proof) }),
  ).rejects.toThrow();
  native.status = "canceled";
  vi.setSystemTime(1400000);
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  await expect(
    t.mutation(retire, {
      key: intent.key,
      proofJson: JSON.stringify({
        ...proof,
        billingReason: "subscription_create",
      }),
    }),
  ).rejects.toThrow();
  await t.mutation(retire, {
    key: intent.key,
    proofJson: JSON.stringify(proof),
  });
  const next = structuredClone(request);
  next.requestId = "next";
  next.meters[0].binding.stripePriceId = "price_next";
  next.meters[0].binding.plan.version = "v2";
  expect(
    await t.mutation(prepare, {
      termsJson: JSON.stringify(next),
      method: "direct",
    }),
  ).toHaveProperty("key");
});
