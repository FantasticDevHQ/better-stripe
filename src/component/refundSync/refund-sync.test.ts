// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import { api } from "../_generated/api.js";

const identity = { stripeRefundId: "re_original", apiContext: "platform" };
const refund = {
  stripeRefundId: "re_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  amount: 250,
  currency: "usd",
  status: "succeeded" as const,
  metadata: { betterStripeRefundCommand: "original-command" },
};
const operation = (name: string) =>
  makeFunctionReference<"mutation">(`refundSync/mutations:${name}`);
async function fixture() {
  const t = convexTest(schema, modules);
  const generation = await t.mutation(operation("begin"), identity);
  return { t, args: { ...identity, generation, refund } };
}

it("replays the same committed generation without changing observed time or its row", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1000);
    const { t, args } = await fixture();
    await t.mutation(operation("finish"), args);
    const first = await t.run((ctx) => ctx.db.query("refunds").unique());
    vi.setSystemTime(2000);
    expect(await t.mutation(operation("finish"), args)).toMatchObject({
      status: "accepted",
      changed: false,
    });
    expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toEqual(
      first,
    );
    expect(
      await t.run((ctx) => ctx.db.query("refundSyncClaims").unique()),
    ).toMatchObject({ acceptedAt: 1000, status: "accepted" });
    await expect(
      t.mutation(operation("finish"), {
        ...args,
        refund: { ...refund, status: "pending" },
      }),
    ).rejects.toThrow("Accepted refund observation changed");
  } finally {
    vi.useRealTimers();
  }
});

it("rejects original money and payment identity changes atomically", async () => {
  const { t, args } = await fixture();
  await t.mutation(operation("finish"), args);
  const before = await t.run((ctx) => ctx.db.query("refunds").unique());
  for (const patch of [
    { amount: 251 },
    { currency: "jpy" },
    { stripePaymentIntentId: "pi_foreign" },
    { stripeChargeId: "ch_foreign" },
  ]) {
    const generation = await t.mutation(operation("begin"), identity);
    await expect(
      t.mutation(operation("finish"), {
        ...args,
        generation,
        refund: { ...refund, ...patch },
      }),
    ).rejects.toThrow("Original refund identity");
    expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toEqual(
      before,
    );
  }
});

it("preserves first command normalization and permanently latches changed or removed keys", async () => {
  const { t, args } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("refunds", {
      ...refund,
      metadata: { betterStripeRefundCommand: "first-original-key" },
    }),
  );
  await t.mutation(operation("finish"), args);
  expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toMatchObject({
    refundCommandKey: "first-original-key",
    refundCommandConflict: true,
    refundCommandNormalizationVersion: 1,
  });
  const observed = (await t.run((ctx) => ctx.db.query("refunds").unique()))!
    .refundCommandObservedAt;
  const generation = await t.mutation(operation("begin"), identity);
  await t.mutation(operation("finish"), {
    ...args,
    generation,
    refund: { ...refund, metadata: {} },
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toMatchObject({
    refundCommandKey: "first-original-key",
    refundCommandConflict: true,
    refundCommandObservedAt: observed,
  });
});

it("keeps omitted legacy metadata distinct from an explicit replacement", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  const { metadata: _metadata, ...partial } = refund;
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...partial,
    status: "pending",
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toMatchObject({
    refundCommandKey: "original-command",
    refundCommandConflict: false,
  });
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    metadata: {},
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").unique())).toMatchObject({
    refundCommandConflict: true,
  });
});

it("retains all 1005 failed/canceled rows while summing only the complete live refund contribution", async () => {
  const { t, args } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1005; i++)
      await ctx.db.insert("refunds", {
        ...refund,
        stripeRefundId: `re_excluded_${i}`,
        amount: 10000,
        status: i % 2 === 0 ? "failed" : "canceled",
      });
    await ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_original",
      userId: "buyer",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });
    for (const [status, amount] of [
      ["pending", 50],
      ["requires_action", 100],
      ["succeeded", 200],
    ] as const)
      await ctx.db.insert("refunds", {
        ...refund,
        stripeRefundId: `re_live_${status}`,
        status,
        amount,
      });
  });
  await t.mutation(operation("finish"), args);
  expect(await t.run((ctx) => ctx.db.query("payments").unique())).toMatchObject(
    { refundedAmount: 600, refundStatus: "partially_refunded" },
  );
  expect(await t.run((ctx) => ctx.db.query("refunds").collect())).toHaveLength(
    1009,
  );
  const generation = await t.mutation(operation("begin"), identity);
  await t.mutation(operation("finish"), {
    ...args,
    generation,
    refund: { ...refund, status: "canceled" },
  });
  expect(await t.run((ctx) => ctx.db.query("payments").unique())).toMatchObject(
    { refundedAmount: 350, refundStatus: "partially_refunded" },
  );
  // The legacy entry point still uses exactly the same full cumulative writer.
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    stripeRefundId: "re_final",
    amount: 650,
  });
  expect(await t.run((ctx) => ctx.db.query("payments").unique())).toMatchObject(
    { refundedAmount: 1000, refundStatus: "fully_refunded" },
  );
});

it("holds a new refund whose provider currency contradicts the registered original payment", async () => {
  const { t, args } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_original",
      userId: "buyer",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    }),
  );
  await expect(
    t.mutation(operation("finish"), {
      ...args,
      refund: { ...refund, currency: "jpy" },
    }),
  ).rejects.toThrow("Original refund merchant");
  expect(await t.run((ctx) => ctx.db.query("refunds").collect())).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("payments").unique()),
  ).not.toHaveProperty("refundedAmount");
});

it("rejects duplicate refund identities or claim rows before mutating either projection", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("refunds", refund);
    await ctx.db.insert("refunds", refund);
  });
  await expect(t.mutation(operation("begin"), identity)).rejects.toThrow(
    "Refund identity is ambiguous",
  );
  expect(
    await t.run((ctx) => ctx.db.query("refundSyncClaims").collect()),
  ).toEqual([]);
  const s = convexTest(schema, modules);
  await s.run(async (ctx) => {
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("refundSyncClaims", {
        stripeRefundId: identity.stripeRefundId,
        requestedContext: "platform",
        generation: 1,
        status: "pending",
        startedAt: 0,
      });
  });
  await expect(s.mutation(operation("begin"), identity)).rejects.toThrow(
    "Refund synchronization is ambiguous",
  );
  expect(
    await s.run((ctx) => ctx.db.query("refundSyncClaims").collect()),
  ).toHaveLength(2);
});

it("holds duplicate original payment identities before the cumulative writer selects a row", async () => {
  const { t, args } = await fixture();
  await t.run(async (ctx) => {
    for (const userId of ["buyer", "foreign"])
      await ctx.db.insert("payments", {
        stripePaymentIntentId: "pi_original",
        userId,
        amount: 1000,
        currency: "usd",
        status: "succeeded",
      });
  });
  await expect(t.mutation(operation("finish"), args)).rejects.toThrow(
    "Original refund merchant",
  );
  expect(await t.run((ctx) => ctx.db.query("refunds").collect())).toEqual([]);
});
