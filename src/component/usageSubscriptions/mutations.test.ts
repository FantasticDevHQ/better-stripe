import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const prepare = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:prepare",
);
const get = makeFunctionReference<"query">("usageSubscriptions/queries:get");
const terms = {
  requestId: "signup1",
  fixedPriceIds: [],
  collection: { method: "send_invoice", daysUntilDue: 30 },
  meters: [
    {
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
    },
  ],
};
it("atomically reserves native customer/meter enrollment and conflicts on changed replay", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  const replay = await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  expect(replay.key).toBe(first.key);
  await expect(
    t.mutation(prepare, {
      termsJson: JSON.stringify({ ...terms, requestId: "other" }),
      method: "direct",
    }),
  ).rejects.toThrow(/enrollment/i);
  await expect(
    t.mutation(prepare, {
      termsJson: JSON.stringify({ ...terms, fixedPriceIds: ["price_base"] }),
      method: "direct",
    }),
  ).rejects.toThrow(/conflict/i);
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  expect(await t.query(get, { scope, requestId: "signup1" })).toMatchObject({
    key: first.key,
  });
  expect(
    await t.query(get, {
      scope: { ...scope, customerAccount: "acct_other" },
      requestId: "signup1",
    }),
  ).toBeNull();
});
it("keeps realm and mode independent while payer aliases cannot duplicate native billing", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  const alias = structuredClone(terms);
  alias.meters[0].scope.customerAccount = "acct_alias";
  await expect(
    t.mutation(prepare, { termsJson: JSON.stringify(alias), method: "direct" }),
  ).rejects.toThrow(/enrollment/i);
  const live = structuredClone(terms);
  live.meters[0].scope.livemode = true;
  expect(
    await t.mutation(prepare, {
      termsJson: JSON.stringify(live),
      method: "direct",
    }),
  ).toHaveProperty("key");
});

it("serializes period-end cancellation commands and rejects changed command replays", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  await t.run(async (ctx) => {
    const doc = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .unique();
    await ctx.db.patch("usageSubscriptionIntents", doc!._id, {
      providerId: "sub_calls",
    });
  });
  const command = makeFunctionReference<"mutation">(
    "usageSubscriptions/mutations:prepareCancellation",
  );
  const args = {
    key: row.key,
    operationId: "cancel1",
    cancelAtPeriodEnd: true,
  };
  const first = await t.mutation(command, args);
  expect((await t.mutation(command, args)).key).toBe(first.key);
  await expect(
    t.mutation(command, { ...args, cancelAtPeriodEnd: false }),
  ).rejects.toThrow(/conflict/i);
  await expect(
    t.mutation(command, {
      ...args,
      operationId: "reactivate2",
      cancelAtPeriodEnd: false,
    }),
  ).rejects.toThrow(/pending/i);
});
