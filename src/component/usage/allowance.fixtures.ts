import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`usageAllowance/mutations:${name}`);
const policy = {
  reset: "billing_period",
  rollover: "none",
  entitled: true,
  overage: "allow",
  limit: { mode: "hard", quantity: "12" },
};
export async function setupAllowance() {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  const meter = {
    ...request.meters[0],
    binding: {
      ...request.meters[0].binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "included_overage",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
        includedQuantity: "10",
        reset: "billing_period",
      },
    },
  };
  const intent = await t.mutation(
    makeFunctionReference<"mutation">("usageSubscriptions/mutations:prepare"),
    {
      termsJson: JSON.stringify({ ...request, meters: [meter] }),
      method: "direct",
    },
  );
  await t.mutation(
    makeFunctionReference<"mutation">("usageSubscriptions/mutations:save"),
    {
      key: intent.key,
      nativeJson: JSON.stringify(nativeSubscription()),
      startedAt: Date.now(),
    },
  );
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  };
  const bindingJson = JSON.stringify({ ...meter, subscription });
  const event = {
    ...meter,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const configure = (value = policy, expectedRevision = 0) =>
    t.mutation(mutation("configure"), {
      bindingJson,
      policyJson: JSON.stringify(value),
      expectedRevision,
    });
  return { t, meter, event, subscription, bindingJson, args, configure };
}
