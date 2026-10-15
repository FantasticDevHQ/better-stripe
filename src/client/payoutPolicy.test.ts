// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "./helpers.js";
import schema from "../component/schema.js";
const modules = import.meta.glob("../component/**/*.*s");
const symbol = Symbol.for("toReferencePath");
const ref = (path: string) => ({ [symbol]: `betterStripe/${path}` });
const component = {
  payoutPolicy: { queries: { get: ref("payoutPolicy/queries/get") } },
} as unknown as Component;
const scope = { accountId: "acct_recipient", ownerKey: "user_1" };
const options = {
  ...scope,
  operationKey: "enable",
  expectedRevision: -1,
  mode: "custom" as const,
  thresholds: [{ currency: "usd", amount: 1000 }],
  consent: true as const,
};
async function feature() {
  const mod = (await import("./payoutPolicy.js").catch(() => ({}))) as {
    PayoutPolicyClient?: typeof import("./payoutPolicy.js").PayoutPolicyClient;
  };
  expect(
    mod.PayoutPolicyClient,
    "public payout-policy client is missing",
  ).toBeTypeOf("function");
  return mod.PayoutPolicyClient!;
}
async function setup() {
  const t = convexTest(schema, modules);
  const path = (r: Record<symbol, string>) =>
    r[symbol].replace("betterStripe/", "").replace(/\/(\w+)$/, ":$1");
  const ctx = {
    runQuery: async (
      r: Record<symbol, string>,
      args: Record<string, unknown>,
    ) => t.query(makeFunctionReference<"query">(path(r)), args),
    runMutation: async (
      r: Record<symbol, string>,
      args: Record<string, unknown>,
    ) => t.mutation(makeFunctionReference<"mutation">(path(r)), args),
  } as unknown as RunCtx;
  let schedule: Record<string, unknown> = {
    interval: "weekly",
    weekly_payout_days: ["monday"],
  };
  const provider = {
    v2: {
      core: {
        accounts: {
          retrieve: vi.fn().mockResolvedValue({
            id: scope.accountId,
            dashboard: "none",
            identity: { country: "US" },
          }),
        },
      },
    },
    balance: {
      retrieve: vi.fn().mockResolvedValue({
        available: [{ currency: "usd", amount: 0 }],
        pending: [],
      }),
    },
    payouts: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    balanceSettings: {
      retrieve: vi.fn(async () => ({
        payments: { payouts: { status: "enabled", schedule } },
      })),
      update: vi.fn(
        async (
          args: {
            payments: { payouts: { schedule: Record<string, unknown> } };
          },
          _request?: unknown,
        ) => {
          schedule = args.payments.payouts.schedule;
          return { payments: { payouts: { status: "enabled", schedule } } };
        },
      ),
    },
  };
  const Client = await feature();
  const client = new Client(component, () => provider as unknown as Stripe);
  return {
    t,
    ctx,
    provider,
    client,
    setSchedule: (value: Record<string, unknown>) => {
      schedule = value;
    },
  };
}
it("persists original provider settings, verifies manual schedule and restores opt-out", async () => {
  const { client, ctx, provider } = await setup();
  const prepared = await client.prepare(ctx, options);
  expect(prepared.status).toBe("prepared");
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
  expect((await client.get(ctx, scope))!.status).toBe("changing");
  const applied = await client.apply(ctx, { ...scope, operationKey: "enable" });
  expect(applied.status).toBe("ready");
  expect(await client.verify(ctx, scope)).toMatchObject({
    status: "verified",
    providerMinimum: null,
  });
  await client.prepare(ctx, {
    ...options,
    operationKey: "disable",
    expectedRevision: 0,
    mode: "stripe_managed",
    thresholds: [],
    consent: undefined,
  });
  await client.apply(ctx, { ...scope, operationKey: "disable" });
  expect(provider.balanceSettings.update.mock.calls[1][0]).toMatchObject({
    payments: {
      payouts: {
        schedule: { interval: "weekly", weekly_payout_days: ["monday"] },
      },
    },
  });
  expect((await client.get(ctx, scope))!.mode).toBe("stripe_managed");
});
it("recovers provider success after a failed persistence write without changing the request", async () => {
  const { client, ctx, provider } = await setup();
  await client.prepare(ctx, options);
  const original = ctx.runMutation!;
  let fail = true;
  ctx.runMutation = (async (
    ref: FunctionReference<"mutation", "public" | "internal">,
    args: Record<string, unknown>,
  ) => {
    if (
      fail &&
      (ref as unknown as Record<symbol, string>)[symbol].endsWith("/confirm")
    ) {
      fail = false;
      throw new Error("write failed");
    }
    return original(ref, args);
  }) as RunCtx["runMutation"];
  await expect(
    client.apply(ctx, { ...scope, operationKey: "enable" }),
  ).rejects.toThrow("write failed");
  expect((await client.get(ctx, scope))!.status).toBe("changing");
  expect(
    (await client.apply(ctx, { ...scope, operationKey: "enable" })).status,
  ).toBe("ready");
  expect(provider.balanceSettings.update).toHaveBeenCalledTimes(1);
  expect(provider.balanceSettings.update.mock.calls[0][1]).toMatchObject({
    stripeAccount: scope.accountId,
    idempotencyKey: expect.any(String),
  });
});
it("does not adopt arbitrary existing balances or in-flight payouts as earnings", async () => {
  const { client, ctx, provider } = await setup();
  provider.balance.retrieve.mockResolvedValueOnce({
    available: [{ currency: "usd", amount: 100 }],
    pending: [],
  });
  expect(await client.prepare(ctx, options)).toMatchObject({
    status: "migration_required",
    reason: "existing_balance",
  });
  expect(await client.get(ctx, scope))!.toBeNull();
  provider.payouts.list.mockResolvedValueOnce({
    data: [{ id: "po_old" }],
    has_more: false,
  } as never);
  expect(await client.prepare(ctx, options)).toMatchObject({
    status: "migration_required",
    reason: "in_flight_payouts",
  });
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
});
it("returns a limitation for Dashboard withdrawal bypass and never changes account liability", async () => {
  const { client, ctx, provider } = await setup();
  provider.v2.core.accounts.retrieve.mockResolvedValueOnce({
    id: scope.accountId,
    dashboard: "full",
    identity: { country: "US" },
  });
  expect(await client.prepare(ctx, options)).toMatchObject({
    status: "unsupported",
    reason: "payout_control_unverified",
  });
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
});
it("fails closed on drift and leaves an unknown provider write pending for retry", async () => {
  const { client, ctx, provider, setSchedule } = await setup();
  await client.prepare(ctx, options);
  provider.balanceSettings.update.mockRejectedValueOnce(
    new Error("network unavailable"),
  );
  await expect(
    client.apply(ctx, { ...scope, operationKey: "enable" }),
  ).rejects.toThrow("network unavailable");
  expect((await client.get(ctx, scope))!.status).toBe("changing");
  setSchedule({ interval: "daily" });
  expect(
    await client.apply(ctx, { ...scope, operationKey: "enable" }),
  ).toMatchObject({ status: "schedule_drift" });
});
it("requires consent and scope/version validation before provider access", async () => {
  const { client, ctx, provider } = await setup();
  await expect(
    client.prepare(ctx, { ...options, consent: undefined }),
  ).rejects.toThrow(/consent/);
  await expect(
    client.prepare(ctx, { ...options, expectedRevision: 0.5 }),
  ).rejects.toThrow(/revision/);
  expect(provider.v2.core.accounts.retrieve).not.toHaveBeenCalled();
});
it("restores original settings at the holding deadline, without extending it", async () => {
  const { client, ctx, t, provider } = await setup();
  await client.prepare(ctx, options);
  await client.apply(ctx, { ...scope, operationKey: "enable" });
  expect((await client.expire(ctx, scope)).status).toBe("not_due");
  await t.run(async (c) => {
    const p = await c.db.query("payoutPolicies").first();
    await c.db.patch(p!._id, { holdDeadline: Date.now() - 1 });
  });
  expect((await client.expire(ctx, scope)).status).toBe("ready");
  expect((await client.get(ctx, scope))!.mode).toBe("stripe_managed");
  expect(provider.balanceSettings.update).toHaveBeenCalledTimes(2);
});
it("re-checks live control on every payout-policy verification", async () => {
  const { client, ctx, setSchedule } = await setup();
  await client.prepare(ctx, options);
  await client.apply(ctx, { ...scope, operationKey: "enable" });
  setSchedule({ interval: "daily" });
  expect(await client.verify(ctx, scope)).toMatchObject({
    status: "schedule_drift",
  });
});
it("reports a staged initial enable as pending rather than unconfigured", async () => {
  const { client, ctx } = await setup();
  await client.prepare(ctx, options);
  expect(await client.verify(ctx, scope)).toMatchObject({
    status: "pending_operation",
  });
});
it("restores opt-out even after exclusive Dashboard control is lost", async () => {
  const { client, ctx, provider } = await setup();
  await client.prepare(ctx, options);
  await client.apply(ctx, { ...scope, operationKey: "enable" });
  provider.v2.core.accounts.retrieve.mockResolvedValue({
    id: scope.accountId,
    dashboard: "full",
    identity: { country: "US" },
  });
  expect(
    (
      await client.prepare(ctx, {
        ...options,
        operationKey: "off-lost-control",
        expectedRevision: 0,
        mode: "stripe_managed",
        thresholds: [],
      })
    ).status,
  ).toBe("prepared");
  expect(
    (await client.apply(ctx, { ...scope, operationKey: "off-lost-control" }))
      .status,
  ).toBe("ready");
});
it("cancels an expired, unattempted enable without switching a live schedule to manual", async () => {
  const { client, ctx, t, provider } = await setup();
  await client.prepare(ctx, options);
  await t.run(async (c) => {
    const p = await c.db.query("payoutPolicies").first();
    await c.db.patch(p!._id, { holdDeadline: Date.now() - 1 });
  });
  await client.expire(ctx, scope);
  expect((await client.get(ctx, scope))!.mode).toBe("stripe_managed");
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
});
it("reports explicit Stripe permission denials and keeps uncertain operations held", async () => {
  const { client, ctx, provider } = await setup();
  const denied = () =>
    Object.assign(new Error("permission denied"), {
      type: "StripePermissionError",
    });
  provider.v2.core.accounts.retrieve.mockRejectedValueOnce(denied());
  expect(await client.prepare(ctx, options)).toMatchObject({
    status: "unsupported",
    reason: "provider_permission_denied",
  });
  await client.prepare(ctx, options);
  provider.balanceSettings.update.mockRejectedValueOnce(denied());
  expect(
    await client.apply(ctx, { ...scope, operationKey: "enable" }),
  ).toMatchObject({
    status: "unsupported",
    reason: "provider_permission_denied",
  });
  expect((await client.get(ctx, scope))!.status).toBe("changing");
});
it("rechecks delayed activation and cancels safely when funds arrive after preparation", async () => {
  const { client, ctx, provider } = await setup();
  await client.prepare(ctx, options);
  provider.balance.retrieve.mockResolvedValueOnce({
    available: [{ currency: "usd", amount: 100 }],
    pending: [],
  });
  expect(
    await client.apply(ctx, { ...scope, operationKey: "enable" }),
  ).toMatchObject({ status: "migration_required", reason: "existing_balance" });
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
  expect(await client.get(ctx, scope)).toMatchObject({
    mode: "stripe_managed",
    status: "ready",
  });
});
it("requires adoption for historical payouts even when today's balance is zero", async () => {
  const { client, ctx, provider } = await setup();
  provider.payouts.list.mockImplementation(
    async (params?: { status?: string }) =>
      ({
        data: params?.status ? [] : [{ id: "po_old" }],
        has_more: false,
      }) as never,
  );
  expect(await client.prepare(ctx, options)).toMatchObject({
    status: "migration_required",
    reason: "existing_payout_history",
  });
  expect(provider.balanceSettings.update).not.toHaveBeenCalled();
  expect(await client.get(ctx, scope)).toBeNull();
});
