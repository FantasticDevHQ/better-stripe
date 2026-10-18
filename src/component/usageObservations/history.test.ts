import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const ref = (name: string) => makeFunctionReference<"mutation">(name);
it("retains paged delivery attempts and outcomes without admitting a foreign scope", async () => {
  const t = convexTest(schema, modules),
    now = Math.floor(Date.now() / 1000);
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  };
  const receipt = await t.mutation(ref("usage/mutations:record"), {
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
      sourceEventId: "one",
      quantity: "1",
      occurredAt: now,
    }),
    subscriptionJson: JSON.stringify({
      subscriptionId: "sub_calls",
      subscriptionItemId: "si_calls",
      stripePriceId: "price_calls",
      period: { start: now - 1, end: now + 86400 },
      interval: "month",
    }),
  });
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageOutbox").first())!;
    await ctx.db.patch("usageOutbox", row._id, { definitionVersion: 1 });
  });
  const claimed = await t.mutation(ref("usageDelivery/steps:claim"), {
    scope,
    eventId: receipt.eventId,
  });
  await t.mutation(ref("usageDelivery/steps:save"), {
    ...claimed.request,
    outcome: { status: "accepted", created: now },
  });
  const history = makeFunctionReference<"query">(
    "usageObservations/queries:deliveryHistory",
  );
  const args = {
    scope,
    eventId: receipt.eventId,
    paginationOpts: { cursor: null, numItems: 1 },
  };
  const first = await t.query(history, args);
  expect(first).toMatchObject({
    page: [{ phase: "started", attempt: 1, sequence: 1 }],
    isDone: false,
    legacyHistoryMissing: false,
  });
  const second = await t.query(history, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  });
  expect(second).toMatchObject({
    page: [{ phase: "accepted", attempt: 1, sequence: 2 }],
  });
  expect(
    await t.query(history, {
      ...args,
      paginationOpts: { cursor: second.continueCursor, numItems: 1 },
    }),
  ).toMatchObject({ page: [], isDone: true });
  await expect(
    t.query(history, {
      ...args,
      scope: { ...scope, customerAccount: "acct_other" },
    }),
  ).rejects.toThrow();
});
