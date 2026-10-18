import { BetterStripe } from "../../client/index.js";
import type { Component } from "../../client/helpers.js";
import type { UsageDeliveryStartOptions } from "../../client/usage/deliveryClient.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import * as steps from "./steps.js";
import { request } from "./schema.js";
import { outcome as outcomeValidator } from "./fields.js";
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import {
  anyApi,
  componentsGeneric,
  internalQueryGeneric,
  defineSchema,
  internalActionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
const nested = componentsGeneric();
const scope = {
  stripeAccountId: "acct_platform",
  customerAccount: "acct_buyer",
  meterId: "mtr_calls",
  livemode: false,
};
let calls = 0;
let saveFailures = 0;
let providerThrows = false;
let outcomes: Array<Record<string, unknown>> = [];
const host = {
  start: internalMutationGeneric({
    args: { source: v.string() },
    returns: v.any(),
    handler: async (ctx, { source }) => {
      const now = Math.floor(Date.now() / 1000);
      const event = await ctx.runMutation(
        nested.betterStripe.usage.mutations.record,
        {
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
            sourceEventId: source,
            quantity: "2",
            occurredAt: now,
          }),
          subscriptionJson: JSON.stringify({
            subscriptionId: "sub_calls",
            subscriptionItemId: "si_calls",
            stripePriceId: "price_calls",
            period: { start: now - 3600, end: now + 86400 },
            interval: "month",
          }),
        },
      );
      return new BetterStripe(
        nested.betterStripe as unknown as Component,
      ).usage.startDelivery(ctx, {
        scope,
        eventId: event.eventId,
        provider: anyApi.host.provider as UsageDeliveryStartOptions["provider"],
      });
    },
  }),
  provider: internalActionGeneric({
    args: {
      scope: v.any(),
      eventId: v.string(),
      attempt: v.number(),
      definitionVersion: v.number(),
      apiVersion: v.string(),
      identifier: v.string(),
    },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls++;
      if (providerThrows)
        throw new Error("sk_test_PRIVATE private provider body");
      const outcome = outcomes.shift() ?? {
        status: "accepted",
        created: Math.floor(Date.now() / 1000),
      };
      return { ...args, outcome };
    },
  }),
};
async function fixture() {
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./host.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/usageDelivery/steps.ts": async () => ({
      ...steps,
      save: internalMutationGeneric({
        args: { ...request, outcome: outcomeValidator },
        returns: v.any(),
        handler: async (ctx, args) => {
          if (saveFailures-- > 0)
            throw new Error("Usage receipt projection failed");
          return (
            steps.save as unknown as {
              _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
            }
          )._handler(ctx, args);
        },
      }),
    }),
    "./component/fixture.ts": async () => ({
      history: internalQueryGeneric({
        args: {},
        returns: v.any(),
        handler: async (ctx) => {
          const op = (await ctx.db.query("usageOutbox").first())!;
          return executionWorkflow.listSteps(ctx, op.workflowId!, {
            paginationOpts: { cursor: null, numItems: 100 },
          });
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  return t;
}
beforeEach(() => {
  vi.useFakeTimers();
  calls = 0;
  outcomes = [];
  saveFailures = 0;
  providerThrows = false;
});
afterEach(() => vi.useRealTimers());
it("dispatches duplicate requests once through the existing nested Workflow", async () => {
  const t = await fixture();
  const first = await t.mutation(anyApi.host.start, { source: "one" });
  const replay = await t.mutation(anyApi.host.start, { source: "one" });
  expect(replay.eventId).toBe(first.eventId);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: first.eventId,
    }),
  ).toMatchObject({ state: "provider_accepted", attempts: 1 });
});

it("backs off known rate limits without losing partial-batch progress", async () => {
  const t = await fixture();
  outcomes = [
    { status: "rate_limited" },
    { status: "accepted", created: Math.floor(Date.now() / 1000) },
  ];
  const a = await t.mutation(anyApi.host.start, { source: "a" });
  const b = await t.mutation(anyApi.host.start, { source: "b" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(3);
  for (const op of [a, b])
    expect(
      await t.query(nested.betterStripe.usageDelivery.queries.get, {
        scope,
        eventId: op.eventId,
      }),
    ).toMatchObject({ state: "provider_accepted" });
});
it("holds unknown effects and refuses blind resume even inside the dedupe window", async () => {
  const t = await fixture();
  outcomes = [{ status: "unknown" }];
  const op = await t.mutation(anyApi.host.start, { source: "unknown" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "unknown", reason: "provider_outcome_unknown" });
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
});
it("rejects foreign scope controls and preserves acceptance when held", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, { source: "held" });
  await t.mutation(nested.betterStripe.usageDelivery.mutations.hold, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(0);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "held", held: true });
  await expect(
    t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
      scope: { ...scope, customerAccount: "acct_foreign" },
      eventId: op.eventId,
    }),
  ).rejects.toThrow();
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
});

it("retains transport acceptance alongside scoped asynchronous validation errors", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, { source: "async" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const receipt = await t.query(nested.betterStripe.usageDelivery.queries.get, {
    scope,
    eventId: op.eventId,
  });
  const report = {
    stripeAccountId: scope.stripeAccountId,
    livemode: false,
    providerEventId: "evt_error",
    meterId: scope.meterId,
    samples: [
      {
        identifier: receipt.providerIdentifier,
        code: "meter_event_customer_not_found",
      },
    ],
    truncated: false,
  };
  await t.mutation(
    nested.betterStripe.usageDelivery.mutations.recordErrorReport,
    report,
  );
  await t.mutation(
    nested.betterStripe.usageDelivery.mutations.recordErrorReport,
    report,
  );
  const final = await t.query(nested.betterStripe.usageDelivery.queries.get, {
    scope,
    eventId: op.eventId,
  });
  expect(final).toMatchObject({
    state: "provider_accepted",
    validationErrors: [
      { code: "meter_event_customer_not_found", providerEventId: "evt_error" },
    ],
  });
  expect(final.validationErrors).toHaveLength(1);
  expect(
    await t.mutation(
      nested.betterStripe.usageDelivery.mutations.recordErrorReport,
      {
        ...report,
        stripeAccountId: "acct_foreign",
        providerEventId: "evt_foreign",
      },
    ),
  ).toMatchObject({ matched: 0, unattributed: 1 });
});

it("restarts a failed receipt projection without repeating the provider step", async () => {
  const t = await fixture();
  saveFailures = 1;
  const op = await t.mutation(anyApi.host.start, { source: "projection" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "provider_accepted" });
});
it("holds provider exceptions without journaling private data", async () => {
  const t = await fixture();
  providerThrows = true;
  const op = await t.mutation(anyApi.host.start, { source: "private" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "unknown" });
  const journal = JSON.stringify(
    await t.query(nested.betterStripe.fixture.history, {}),
  );
  expect(journal).not.toContain("sk_test_PRIVATE");
  expect(journal).not.toContain("private provider body");
});
it("stops retryable failures after three sends and supports explicit credential recovery", async () => {
  const t = await fixture();
  outcomes = [{ status: "unavailable" }];
  const op = await t.mutation(anyApi.host.start, { source: "unavailable" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "held", reason: "provider_unavailable" });
  outcomes = [
    { status: "rate_limited" },
    { status: "rate_limited" },
    { status: "rate_limited" },
  ];
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(4);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "held", reason: "retry_exhausted" });
});

it("holds an expired deduplication window without another provider call", async () => {
  const t = await fixture();
  outcomes = [{ status: "unavailable" }];
  const op = await t.mutation(anyApi.host.start, { source: "expired" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.setSystemTime(Date.now() + 24 * 3600 * 1000);
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "unknown", reason: "delivery_window_expired" });
});
it("holds an event whose native timestamp window elapsed before first dispatch", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, { source: "late" });
  await t.mutation(nested.betterStripe.usageDelivery.mutations.hold, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.setSystemTime(Date.now() + 36 * 86400 * 1000);
  await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
    scope,
    eventId: op.eventId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(0);
  expect(
    await t.query(nested.betterStripe.usageDelivery.queries.get, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "held", reason: "delivery_window_expired" });
});

it("clears an administrative hold on a completed event without another send", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, { source: "completed-hold" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(nested.betterStripe.usageDelivery.mutations.hold, {
    scope,
    eventId: op.eventId,
  });
  expect(
    await t.mutation(nested.betterStripe.usageDelivery.mutations.resume, {
      scope,
      eventId: op.eventId,
    }),
  ).toMatchObject({ state: "provider_accepted", held: false });
  expect(calls).toBe(1);
});
