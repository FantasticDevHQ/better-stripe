import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const prepare = makeFunctionReference<"mutation">(
    "usageSubscriptions/mutations:prepare",
  ),
  save = makeFunctionReference<"mutation">("usageSubscriptions/mutations:save"),
  history = makeFunctionReference<"query">(
    "usageSubscriptions/queries:history",
  ),
  get = makeFunctionReference<"query">("usageSubscriptions/queries:get");
it("retains original and renewed snapshots, deduplicates replay and keeps newer projections", async () => {
  const t = convexTest(schema, modules),
    now = Date.now();
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(request),
    method: "direct",
  });
  const first = nativeSubscription(),
    renewed = nativeSubscription();
  renewed.items.data.forEach((item) => {
    item.current_period_start = 1200;
    item.current_period_end = 1800;
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(renewed),
    startedAt: now,
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(first),
    startedAt: now - 1,
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(first),
    startedAt: now - 1,
  });
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  const projection = await t.query(get, { scope, requestId: "signup1" });
  expect(
    JSON.parse(projection.viewJson).bindings[0].subscription.period.start,
  ).toBe(1200);
  const page = await t.query(history, {
    scope,
    requestId: "signup1",
    kind: "subscription",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(2);
  await expect(
    t.query(history, {
      scope: { ...scope, customerAccount: "acct_other" },
      requestId: "signup1",
      kind: "subscription",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow();
});

it("retains the newer projection when conflicting native observations have the same timestamp", async () => {
  const t = convexTest(schema, modules),
    now = Date.now();
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(request),
    method: "direct",
  });
  const renewed = nativeSubscription();
  renewed.items.data.forEach((item) => {
    item.current_period_start = 1200;
    item.current_period_end = 1800;
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(renewed),
    startedAt: now,
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(nativeSubscription()),
    startedAt: now,
  });
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  const projection = await t.query(get, { scope, requestId: "signup1" });
  expect(
    JSON.parse(projection.viewJson).bindings[0].subscription.period.start,
  ).toBe(1200);
  const page = await t.query(history, {
    scope,
    requestId: "signup1",
    kind: "subscription",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(2);
});

it("reserves distinct ordered observations before native I/O in a concurrent clock tick", async () => {
  const t = convexTest(schema, modules);
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(request),
    method: "direct",
  });
  const begin = makeFunctionReference<"mutation">(
    "usageSubscriptions/mutations:beginObservation",
  );
  const stamps = await Promise.all([
    t.mutation(begin, { key: intent.key }),
    t.mutation(begin, { key: intent.key }),
  ]);
  expect(new Set(stamps).size).toBe(2);
  expect(stamps.every(Number.isSafeInteger)).toBe(true);
});
