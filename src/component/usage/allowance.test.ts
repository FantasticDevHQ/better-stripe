import { setupAllowance as setup } from "./allowance.fixtures.js";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { nativeSubscription } from "../../client/usage/subscription.fixtures.js";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`usageAllowance/mutations:${name}`);
const status = makeFunctionReference<"query">("usageAllowance/queries:status");
const record = makeFunctionReference<"mutation">("usage/mutations:record");
const policy = {
  reset: "billing_period",
  rollover: "none",
  entitled: true,
  overage: "allow",
  limit: { mode: "hard", quantity: "12" },
};

afterEach(() => vi.useRealTimers());
it("reserves a hard cap atomically and commits included usage and overage exactly once", async () => {
  const { t, args, configure, bindingJson, event } = await setup();
  expect(await configure()).toEqual({ revision: 1 });
  const a = await t.mutation(mutation("reserve"), args);
  expect(a.state).toBe("reserved");
  expect(await t.mutation(mutation("reserve"), args)).toEqual(a);
  const outcomes = await Promise.all(
    ["work2", "work3"].map((sourceEventId) =>
      t.mutation(mutation("reserve"), {
        ...args,
        inputJson: JSON.stringify({ ...event, sourceEventId }),
      }),
    ),
  );
  expect(outcomes.map((o) => o.state).sort()).toEqual(["denied", "reserved"]);
  await expect(t.mutation(record, args)).rejects.toThrow(
    /reservation required/i,
  );
  const receipt = await t.mutation(record, {
    ...args,
    reservationId: a.reservationId,
  });
  expect(
    await t.mutation(record, { ...args, reservationId: a.reservationId }),
  ).toEqual(receipt);
  expect(JSON.parse(await t.query(status, { bindingJson }))).toMatchObject({
    revision: 1,
    consumedQuantity: "6",
    reservedQuantity: "6",
    remainingIncludedQuantity: "0",
    billableOverageQuantity: "0",
    committedEstimate: { amountDecimal: "0", currency: "usd" },
    projectedEstimate: { amountDecimal: "4", currency: "usd" },
  });
});
it("does not let retired native enrollment look accepting in a fresh status read", async () => {
  const { t, bindingJson, configure } = await setup();
  await configure();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("usageSubscriptionIntents").first();
    await ctx.db.patch("usageSubscriptionIntents", row!._id, {
      retiredAt: 701,
    });
  });
  expect(JSON.parse(await t.query(status, { bindingJson })).accepting).toBe(
    false,
  );
});
it("does not bypass a configured scope with a different native customer on an unmanaged subscription", async () => {
  const { t, configure, event, subscription } = await setup();
  await configure();
  await expect(
    t.mutation(record, {
      inputJson: JSON.stringify({
        ...event,
        binding: { ...event.binding, stripeCustomerId: "cus_other" },
      }),
      subscriptionJson: JSON.stringify({
        ...subscription,
        subscriptionId: "sub_other",
      }),
    }),
  ).rejects.toThrow(/allowance/i);
});
it("retains consumed and reserved units across cap changes and stale policy edits", async () => {
  const { t, args, configure, bindingJson } = await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  await t.mutation(record, { ...args, reservationId: a.reservationId });
  expect(
    await configure({ ...policy, limit: { mode: "hard", quantity: "4" } }, 1),
  ).toEqual({ revision: 2 });
  expect(JSON.parse(await t.query(status, { bindingJson }))).toMatchObject({
    revision: 2,
    consumedQuantity: "6",
    hardLimitRemainingQuantity: "0",
    accepting: false,
  });
  await expect(configure({ ...policy, entitled: false }, 1)).rejects.toThrow(
    /stale/i,
  );
  expect(await configure({ ...policy, entitled: false }, 2)).toEqual({
    revision: 3,
  });
  const denied = await t.mutation(mutation("reserve"), {
    ...args,
    inputJson: JSON.stringify({
      ...JSON.parse(args.inputJson),
      sourceEventId: "work2",
    }),
  });
  expect(denied).toMatchObject({
    state: "denied",
    reason: "not_entitled",
    revision: 3,
  });
});
it("retains abandoned reservations across timeouts and releases explicit failed work exactly once", async () => {
  const { t, args, configure, bindingJson, meter } = await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  vi.setSystemTime(900000);
  expect(
    JSON.parse(await t.query(status, { bindingJson })).reservedQuantity,
  ).toBe("6");
  await expect(
    t.mutation(mutation("release"), {
      scope: { ...meter.scope, customerAccount: "acct_other" },
      reservationId: a.reservationId,
      reason: "work_failed",
    }),
  ).rejects.toThrow(/unavailable/i);
  const releaseArgs = {
    scope: meter.scope,
    reservationId: a.reservationId,
    reason: "abandoned_before_work",
  };
  await t.mutation(mutation("release"), releaseArgs);
  await t.mutation(mutation("release"), releaseArgs);
  expect(
    JSON.parse(await t.query(status, { bindingJson })).reservedQuantity,
  ).toBe("0");
  expect(await t.mutation(mutation("reserve"), args)).toMatchObject({
    state: "released",
    reservationId: a.reservationId,
  });
  await expect(
    t.mutation(record, { ...args, reservationId: a.reservationId }),
  ).rejects.toThrow(/does not match/i);
  await expect(
    t.mutation(mutation("release"), { ...releaseArgs, reason: "work_failed" }),
  ).rejects.toThrow(/replay conflict/i);
});
it("starts a fresh verified billing period without resetting old counters or replaying historical sources", async () => {
  const { t, args, configure, bindingJson, meter, subscription, event } =
    await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  await t.mutation(record, { ...args, reservationId: a.reservationId });
  vi.setSystemTime(1300000);
  const native = nativeSubscription();
  for (const item of native.items.data) {
    item.current_period_start = 1200;
    item.current_period_end = 1800;
  }
  const intent = await t.run((ctx) =>
    ctx.db.query("usageSubscriptionIntents").first(),
  );
  await t.mutation(
    makeFunctionReference<"mutation">("usageSubscriptions/mutations:save"),
    {
      key: intent!.key,
      nativeJson: JSON.stringify(native),
      startedAt: Date.now(),
    },
  );
  const next = { ...subscription, period: { start: 1200, end: 1800 } },
    nextJson = JSON.stringify({ ...meter, subscription: next });
  await expect(
    t.mutation(record, {
      inputJson: JSON.stringify({
        ...event,
        sourceEventId: "bypassNewPeriod",
        occurredAt: 1300,
      }),
      subscriptionJson: JSON.stringify(next),
    }),
  ).rejects.toThrow(/allowance/i);
  await t.mutation(mutation("configure"), {
    bindingJson: nextJson,
    policyJson: JSON.stringify(policy),
    expectedRevision: 0,
  });
  expect(
    JSON.parse(await t.query(status, { bindingJson: nextJson })),
  ).toMatchObject({
    consumedQuantity: "0",
    reservedQuantity: "0",
    remainingIncludedQuantity: "10",
  });
  expect(JSON.parse(await t.query(status, { bindingJson }))).toMatchObject({
    consumedQuantity: "6",
    accepting: false,
  });
  await expect(
    t.mutation(mutation("reserve"), {
      inputJson: JSON.stringify({ ...event, occurredAt: 1300 }),
      subscriptionJson: JSON.stringify(next),
    }),
  ).rejects.toThrow(/replay conflict/i);
  await t.mutation(mutation("reserve"), {
    inputJson: JSON.stringify({
      ...event,
      sourceEventId: "workNewPeriod",
      occurredAt: 1300,
    }),
    subscriptionJson: JSON.stringify(next),
  });
});
it("warns at a soft threshold but permits overage at the original exact rate", async () => {
  const { t, args, configure, bindingJson } = await setup();
  await configure({ ...policy, limit: { mode: "soft", quantity: "5" } });
  for (const sourceEventId of ["work1", "work2", "work3"]) {
    const input = {
      ...args,
      inputJson: JSON.stringify({
        ...JSON.parse(args.inputJson),
        sourceEventId,
      }),
    };
    const a = await t.mutation(mutation("reserve"), input);
    await t.mutation(record, { ...input, reservationId: a.reservationId });
  }
  expect(JSON.parse(await t.query(status, { bindingJson }))).toMatchObject({
    consumedQuantity: "18",
    softLimitReached: true,
    accepting: true,
    billableOverageQuantity: "8",
    committedEstimate: { amountDecimal: "16", currency: "usd" },
    cashCollection: "none",
  });
});
it("rejects changed native price terms, overlapping periods and late setup over unaccounted usage", async () => {
  const { t, args, bindingJson, configure, subscription } = await setup();
  await t.mutation(record, args);
  await expect(configure()).rejects.toThrow(/existing period usage/i);
  const f = await setup();
  await f.configure();
  const b = JSON.parse(bindingJson);
  b.binding.plan.includedQuantity = "20";
  await expect(
    f.t.mutation(mutation("configure"), {
      bindingJson: JSON.stringify(b),
      policyJson: JSON.stringify(policy),
      expectedRevision: 1,
    }),
  ).rejects.toThrow();
  const overlap = {
    ...JSON.parse(bindingJson),
    subscription: { ...subscription, period: { start: 601, end: 1200 } },
  };
  await expect(
    f.t.mutation(mutation("configure"), {
      bindingJson: JSON.stringify(overlap),
      policyJson: JSON.stringify(policy),
      expectedRevision: 0,
    }),
  ).rejects.toThrow();
});
it("holds accounting reconciliation on incomplete or mismatched local evidence without restoring units", async () => {
  const { t, args, configure, bindingJson } = await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  await t.mutation(record, { ...args, reservationId: a.reservationId });
  const reconcile = makeFunctionReference<"query">(
    "usageAllowance/queries:reconciliation",
  );
  expect(await t.query(reconcile, { bindingJson })).toMatchObject({
    status: "matched",
    consumedScaledQuantity: "6",
    reservedScaledQuantity: "0",
    acceptedScaledQuantity: "6",
    repaired: false,
  });
  await t.run(async (ctx) => {
    const row = await ctx.db.query("usageAllowancePolicies").first();
    await ctx.db.patch("usageAllowancePolicies", row!._id, { consumed: "7" });
  });
  expect(await t.query(reconcile, { bindingJson })).toMatchObject({
    status: "held",
    reason: "accounting_mismatch",
    repaired: false,
  });
  expect(
    JSON.parse(await t.query(status, { bindingJson })).consumedQuantity,
  ).toBe("7");
});
it("does not refund allowance on provider uncertainty, committed release or conflicting replay", async () => {
  const { t, args, configure, bindingJson, meter, event } = await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  await expect(
    t.mutation(mutation("reserve"), {
      ...args,
      inputJson: JSON.stringify({ ...event, quantity: "7" }),
    }),
  ).rejects.toThrow(/replay conflict/i);
  const receipt = await t.mutation(record, {
    ...args,
    reservationId: a.reservationId,
  });
  await t.run(async (ctx) => {
    const outbox = await ctx.db.query("usageOutbox").first();
    await ctx.db.patch("usageOutbox", outbox!._id, { state: "unknown" });
  });
  await expect(
    t.mutation(mutation("release"), {
      scope: meter.scope,
      reservationId: a.reservationId,
      reason: "work_failed",
    }),
  ).rejects.toThrow(/correction/i);
  expect(
    await t.mutation(record, { ...args, reservationId: a.reservationId }),
  ).toEqual(receipt);
  expect(
    JSON.parse(await t.query(status, { bindingJson })).consumedQuantity,
  ).toBe("6");
  const history = makeFunctionReference<"query">(
    "usageAllowance/queries:readHistory",
  );
  await expect(
    t.query(history, {
      bindingJson,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow(/page/i);
  await expect(
    t.query(history, {
      bindingJson: JSON.stringify({
        ...JSON.parse(bindingJson),
        scope: { ...meter.scope, customerAccount: "acct_other" },
      }),
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow(/unavailable/i);
});
it("reports bounded reconciliation as held instead of equating a partial history with zero", async () => {
  const { t, configure, bindingJson, args } = await setup();
  await configure();
  const a = await t.mutation(mutation("reserve"), args);
  await t.mutation(record, { ...args, reservationId: a.reservationId });
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageEvents").first())!;
    for (let i = 0; i < 500; i++)
      await ctx.db.insert("usageEvents", {
        scopeKey: row.scopeKey,
        identity: `synthetic_${i}`,
        recordJson: row.recordJson,
        subscriptionJson: row.subscriptionJson,
        occurredAt: row.occurredAt,
        acceptedAt: row.acceptedAt,
        subscriptionId: row.subscriptionId,
      });
  });
  const reconcile = makeFunctionReference<"query">(
    "usageAllowance/queries:reconciliation",
  );
  expect(await t.query(reconcile, { bindingJson })).toMatchObject({
    status: "held",
    reason: "local_evidence_incomplete",
    consumedScaledQuantity: "6",
    repaired: false,
  });
});
