import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const summary = makeFunctionReference<"query">(
    "usageObservations/queries:summary",
  ),
  record = makeFunctionReference<"mutation">("usage/mutations:record");
it("bounds local summaries and never includes another scope", async () => {
  const t = convexTest(schema, modules),
    now = Math.floor(Date.now() / 1000),
    period = { start: now - 5, end: now + 100 };
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  };
  for (const sourceEventId of ["a", "b"])
    await t.mutation(record, {
      inputJson: JSON.stringify({
        scope,
        binding: {
          stripeCustomerId: "cus_buyer",
          stripePriceId: "price_calls",
          eventName: "calls",
          plan: {
            key: "calls",
            version: "v1",
            model: "pay_as_you_go",
            unit: { name: "call", precision: 0 },
            rate: { currency: "usd", unitAmountDecimal: "2" },
          },
        },
        sourceEventId,
        quantity: "1",
        occurredAt: now,
      }),
      subscriptionJson: JSON.stringify({
        subscriptionId: "sub_calls",
        subscriptionItemId: "si_calls",
        stripePriceId: "price_calls",
        period,
        interval: "month",
      }),
    });
  expect(
    JSON.parse(await t.query(summary, { scope, period, maxRecords: 1 })),
  ).toMatchObject({
    complete: false,
    eventCount: 1,
    groups: [
      {
        acceptedQuantity: "1",
        estimate: { status: "unavailable", reason: "local_history_incomplete" },
      },
    ],
  });
  expect(
    JSON.parse(
      await t.query(summary, {
        scope: { ...scope, customerAccount: "acct_other" },
        period,
        maxRecords: 10,
      }),
    ),
  ).toMatchObject({ complete: true, eventCount: 0, groups: [] });
  await expect(
    t.query(summary, { scope, period, maxRecords: 501 }),
  ).rejects.toThrow();
});

it("retains immutable scoped cache bindings and rejects stale projections and raw payloads", async () => {
  const t = convexTest(schema, modules),
    now = Math.floor(Date.now() / 1000),
    period = { start: 600, end: 1200 };
  const source = {
    scope: {
      stripeAccountId: "acct_platform",
      customerAccount: "acct_buyer",
      meterId: "mtr_calls",
      livemode: false,
    },
    binding: {
      stripeCustomerId: "cus_buyer",
      stripePriceId: "price_calls",
      eventName: "calls",
      plan: {
        key: "calls",
        version: "v1",
        model: "pay_as_you_go",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    subscription: {
      subscriptionId: "sub_calls",
      subscriptionItemId: "si_calls",
      stripePriceId: "price_calls",
      period,
      interval: "month",
    },
    period,
    limit: 100,
    cursor: null,
  };
  const save = makeFunctionReference<"mutation">(
      "usageObservations/mutations:save",
    ),
    cached = makeFunctionReference<"query">("usageObservations/queries:cached");
  const observation = {
    status: "available",
    observedAt: now,
    value: {
      period,
      quantity: "1",
      scaledQuantity: "1",
      complete: true,
      nextCursor: null,
      aggregationLagPossible: true,
      stale: false,
      entries: [
        { id: "mtrusg_one", start: 600, end: 1200, scaledQuantity: "1" },
      ],
    },
  };
  const args = {
    sourceJson: JSON.stringify(source),
    observationJson: JSON.stringify(observation),
    startedAt: Date.now(),
  };
  await t.mutation(save, args);
  await t.mutation(save, {
    ...args,
    startedAt: args.startedAt - 1,
    observationJson: JSON.stringify({
      status: "unavailable",
      reason: "provider_unavailable",
      retryable: true,
    }),
  });
  expect(
    JSON.parse(await t.query(cached, { sourceJson: args.sourceJson })),
  ).toMatchObject({ status: "available", value: { quantity: "1" } });
  expect(
    await t.query(cached, {
      sourceJson: JSON.stringify({
        ...source,
        scope: { ...source.scope, customerAccount: "acct_other" },
      }),
    }),
  ).toBeNull();
  await expect(
    t.mutation(save, {
      ...args,
      observationJson: JSON.stringify({
        ...observation,
        privateMetadata: "private",
      }),
    }),
  ).rejects.toThrow("Invalid usage provider observation");
});
