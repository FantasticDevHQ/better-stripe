import { afterEach, expect, it, vi } from "vitest";
import { components, initConvexTest } from "../setup.test.js";
import { schema, modules } from "../../test.js";
import { BetterStripe } from "../index.js";
import { authorizeUsageRecord } from "./boundaries.js";
import { prepareUsageRecord } from "./records.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const stripe = new BetterStripe(components.betterStripe);
  const now = Math.floor(Date.now() / 1000);
  const event = {
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
        unit: { name: "call", precision: 2 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    sourceEventId: "activity_composition",
    quantity: "1.20",
    occurredAt: now,
  };
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: now - 1, end: now + 100 },
    interval: "month",
  };
  const record = (input: unknown) =>
    t.run((ctx) => stripe.usage.record(ctx, { event: input, subscription }));
  const read = () =>
    t.run((ctx) =>
      stripe.usage.read(ctx, {
        scope: event.scope,
        page: { period: subscription.period, limit: 10, cursor: null },
      }),
    );
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(
      new Error("Provider I/O is forbidden for ledger acceptance"),
    );
  return { t, stripe, event, subscription, record, read, fetch };
}

it("composes actual authorization with the registered public ledger and retains scoped replay/conflict/read behavior", async () => {
  const f = fixture();
  const order: string[] = [];
  const receipt = await f.t.run((ctx) =>
    authorizeUsageRecord(
      ctx,
      {
        authorize: async () => {
          order.push("scope");
        },
        authorizeActivity: async () => {
          order.push("activity");
        },
      },
      f.event,
      (event) => {
        order.push("record");
        return f.stripe.usage.record(ctx, {
          event,
          subscription: f.subscription,
        });
      },
    ),
  );
  expect(order).toEqual(["scope", "activity", "record"]);
  expect(receipt.delivery).toBe("queued");
  expect(await f.record(f.event)).toEqual(receipt);
  await expect(
    f.record(prepareUsageRecord({ ...f.event, quantity: "1.21" })),
  ).rejects.toThrow();
  expect((await f.read()).events).toMatchObject([
    { record: { quantity: "1.2", scaledQuantity: "120" } },
  ]);
  expect((await f.read()).events).toHaveLength(1);
  expect(f.fetch).not.toHaveBeenCalled();
});

it("preserves raw strict validation and authorization denial before ledger acceptance", async () => {
  const f = fixture();
  await expect(
    f.t.run((ctx) =>
      authorizeUsageRecord(
        ctx,
        {
          authorize: async () => {
            throw new Error("Denied");
          },
          authorizeActivity: async () => {
            throw new Error("Must not reach activity");
          },
        },
        f.event,
        (event) =>
          f.stripe.usage.record(ctx, { event, subscription: f.subscription }),
      ),
    ),
  ).rejects.toThrow("Denied");
  await expect(f.record({ ...f.event, unexpected: true })).rejects.toThrow();
  expect((await f.read()).events).toEqual([]);
  expect(f.fetch).not.toHaveBeenCalled();
});

it("requires activity approval after successful scope authorization before composing ledger acceptance", async () => {
  const f = fixture();
  const order: string[] = [];
  await expect(
    f.t.run((ctx) =>
      authorizeUsageRecord(
        ctx,
        {
          authorize: async () => {
            order.push("scope");
          },
          authorizeActivity: async () => {
            order.push("activity");
            throw new Error("Activity denied");
          },
        },
        f.event,
        (event) => {
          order.push("record");
          return f.stripe.usage.record(ctx, {
            event,
            subscription: f.subscription,
          });
        },
      ),
    ),
  ).rejects.toThrow("Activity denied");
  expect(order).toEqual(["scope", "activity"]);
  expect((await f.read()).events).toEqual([]);
  expect(f.fetch).not.toHaveBeenCalled();
});

for (const change of [
  "identity",
  "scaledQuantity",
  "schemaVersion",
  "quantity",
  "noncanonicalQuantity",
  "plan",
  "unknown",
  "nestedUnknown",
  "partial",
] as const) {
  it(`rejects ${change} tampering in prepared records without a ledger write`, async () => {
    const f = fixture();
    const prepared = prepareUsageRecord(f.event);
    const input: Record<string, unknown> = structuredClone(prepared);
    if (change === "identity") input.identity = "forged";
    if (change === "scaledQuantity") input.scaledQuantity = "121";
    if (change === "schemaVersion") input.schemaVersion = 2;
    if (change === "quantity") input.quantity = "1.21";
    if (change === "noncanonicalQuantity") input.quantity = "1.20";
    if (change === "plan")
      input.binding = {
        ...prepared.binding,
        plan: {
          ...prepared.binding.plan,
          unit: { name: "call", precision: 1 },
        },
      };
    if (change === "unknown") input.unexpected = true;
    if (change === "nestedUnknown")
      input.binding = { ...prepared.binding, unexpected: true };
    if (change === "partial") delete input.scaledQuantity;
    await expect(f.record(input)).rejects.toThrow();
    expect((await f.read()).events).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });
}
