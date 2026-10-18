import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { record as registeredRecord } from "./mutations.js";
import type { MutationCtx } from "../_generated/server.js";
import { schema, modules } from "../../test.js";

// Codegen runs after the first failing tests; these are genuine function refs.
const record = makeFunctionReference<"mutation">("usage/mutations:record");
const read = makeFunctionReference<"query">("usage/queries:read");
const get = makeFunctionReference<"query">("usage/queries:get");
const now = Math.floor(Date.now() / 1000);
const scope = {
  stripeAccountId: "acct_platform",
  customerAccount: "acct_buyer",
  meterId: "mtr_calls",
  livemode: false,
};
const event = {
  scope,
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "pay_as_you_go",
      unit: { name: "call", precision: 2 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
    },
  },
  sourceEventId: "activity_1",
  quantity: "1.20",
  occurredAt: now,
};
const subscription = {
  subscriptionId: "sub_calls",
  subscriptionItemId: "si_calls",
  stripePriceId: "price_calls",
  period: { start: now - 100, end: now + 1000 },
  interval: "month",
};
const args = (input = event) => ({
  inputJson: JSON.stringify(input),
  subscriptionJson: JSON.stringify(subscription),
});
it("atomically persists a single immutable event and outbox for competing identical replays", async () => {
  const t = convexTest(schema, modules);
  const results = await Promise.all([
    t.mutation(record, args()),
    t.mutation(record, args({ ...event, quantity: "1.2" })),
  ]);
  expect(results[0]).toEqual(results[1]);
  await t.run(async (ctx) => {
    const events = await ctx.db.query("usageEvents").take(10);
    const outbox = await ctx.db.query("usageOutbox").take(10);
    expect(events).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].eventId).toBe(events[0]._id);
    expect(JSON.parse(events[0].recordJson).scaledQuantity).toBe("120");
    expect(await ctx.db.query("usageScopeCounters").first()).toMatchObject({
      count: 1,
    });
  });
});
it("rejects changed versions, amounts, timestamps and subscription bindings without rewriting history", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(record, args());
  for (const changed of [
    { ...event, quantity: "2" },
    { ...event, occurredAt: now - 1 },
    {
      ...event,
      binding: {
        ...event.binding,
        plan: { ...event.binding.plan, version: "v2" },
      },
    },
  ])
    await expect(t.mutation(record, args(changed))).rejects.toThrow(
      "Conflicting usage replay",
    );
  await expect(
    t.mutation(record, {
      ...args(),
      subscriptionJson: JSON.stringify({
        ...subscription,
        subscriptionId: "sub_other",
      }),
    }),
  ).rejects.toThrow("Conflicting usage replay");
});
it("isolates payer/meter/realm/mode and currency snapshots", async () => {
  const t = convexTest(schema, modules);
  for (const changed of [
    event,
    { ...event, scope: { ...scope, customerAccount: "acct_other" } },
    { ...event, scope: { ...scope, meterId: "mtr_other" } },
    { ...event, scope: { ...scope, stripeAccountId: "acct_other" } },
    { ...event, scope: { ...scope, livemode: true } },
  ])
    await t.mutation(record, args(changed));
  await expect(
    t.mutation(
      record,
      args({
        ...event,
        binding: {
          ...event.binding,
          plan: {
            ...event.binding.plan,
            rate: { currency: "eur", unitAmountDecimal: "2" },
          },
        },
      }),
    ),
  ).rejects.toThrow("Conflicting usage replay");
  expect(
    await t.run((ctx) => ctx.db.query("usageEvents").take(10)),
  ).toHaveLength(5);
});
it("rejects out-of-window/period input, oversized payloads and quota exhaustion but returns original replay", async () => {
  const t = convexTest(schema, modules);
  for (const occurredAt of [
    now - 35 * 86400 - 10,
    now + 600,
    subscription.period.end,
  ])
    await expect(
      t.mutation(record, args({ ...event, occurredAt })),
    ).rejects.toThrow();
  await expect(
    t.mutation(record, { ...args(), inputJson: " ".repeat(8193) }),
  ).rejects.toThrow();
  const first = await t.mutation(record, { ...args(), quota: 1 });
  expect(await t.mutation(record, { ...args(), quota: 1 })).toEqual(first);
  await expect(
    t.mutation(record, {
      ...args({ ...event, sourceEventId: "activity_2" }),
      quota: 1,
    }),
  ).rejects.toThrow("Usage scope quota exhausted");
});
it("rolls back event, counter and reservation commit if scheduling fails", async () => {
  const t = convexTest(schema, modules);
  const reservationId = await t.run((ctx) =>
    ctx.db.insert("usageReservations", {
      scopeKey: JSON.stringify(scope),
      sourceEventId: event.sourceEventId,
      planJson: JSON.stringify(event.binding.plan),
      scaledQuantity: "120",
      state: "reserved",
    }),
  );
  await expect(
    t.run((ctx) => {
      const handler = (
        registeredRecord as unknown as {
          _handler: (
            ctx: MutationCtx,
            args: {
              inputJson: string;
              subscriptionJson: string;
              dispatch?: string;
              reservationId?: import("../_generated/dataModel.js").Id<"usageReservations">;
            },
          ) => Promise<unknown>;
        }
      )._handler;
      return handler(
        {
          ...ctx,
          scheduler: {
            ...ctx.scheduler,
            runAfter: async () => {
              throw new Error("Scheduling unavailable");
            },
          },
        } as MutationCtx,
        {
          ...args(),
          dispatch: "function://;usage/delivery:dispatch",
          reservationId,
        },
      );
    }),
  ).rejects.toThrow("Scheduling unavailable");
  expect(await t.run((ctx) => ctx.db.query("usageEvents").take(10))).toEqual(
    [],
  );
  expect(await t.run((ctx) => ctx.db.query("usageOutbox").take(10))).toEqual(
    [],
  );
  expect(
    await t.run((ctx) => ctx.db.query("usageScopeCounters").take(10)),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.get("usageReservations", reservationId)),
  ).toMatchObject({ state: "reserved" });
});
it("requires and atomically commits the exact prepaid reservation", async () => {
  const t = convexTest(schema, modules);
  const input = {
    ...event,
    binding: {
      ...event.binding,
      plan: {
        ...event.binding.plan,
        model: "prepaid",
        insufficientBalance: "reject",
      },
    },
  };
  await expect(t.mutation(record, args(input))).rejects.toThrow(
    "A matching usage reservation is required",
  );
  const reservationId = await t.run((ctx) =>
    ctx.db.insert("usageReservations", {
      scopeKey: JSON.stringify(scope),
      sourceEventId: input.sourceEventId,
      planJson: JSON.stringify(input.binding.plan),
      scaledQuantity: "120",
      state: "reserved",
    }),
  );
  await t.mutation(record, { ...args(input), reservationId });
  expect(
    await t.run((ctx) => ctx.db.get("usageReservations", reservationId)),
  ).toMatchObject({ state: "committed" });
  const secondReservation = await t.run((ctx) =>
    ctx.db.insert("usageReservations", {
      scopeKey: JSON.stringify(scope),
      sourceEventId: input.sourceEventId,
      planJson: JSON.stringify(input.binding.plan),
      scaledQuantity: "120",
      state: "reserved",
    }),
  );
  await expect(
    t.mutation(record, { ...args(input), reservationId: secondReservation }),
  ).rejects.toThrow("Conflicting usage reservation replay");
});

it("pages an explicit period without exposing guessed or cross-scope events", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(record, args());
  await t.mutation(
    record,
    args({ ...event, sourceEventId: "activity_2", occurredAt: now + 1 }),
  );
  expect(
    await t.query(get, {
      scope: { ...scope, customerAccount: "acct_other" },
      eventId: first.eventId,
    }),
  ).toBeNull();
  const request = {
    scope,
    period: { start: now, end: now + 2 },
    paginationOpts: { numItems: 1, cursor: null },
  };
  const page = await t.query(read, request);
  expect(page.page).toHaveLength(1);
  expect(page.isDone).toBe(false);
  const next = await t.query(read, {
    ...request,
    paginationOpts: { numItems: 1, cursor: page.continueCursor },
  });
  expect(next.page).toHaveLength(1);
  expect(next.page[0].event._id).not.toBe(page.page[0].event._id);
  const empty = await t.query(read, {
    ...request,
    period: { start: now - 2, end: now },
  });
  expect(empty.page).toEqual([]);
  await expect(
    t.query(read, {
      ...request,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow();
});
