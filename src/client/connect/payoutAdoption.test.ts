// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  component,
  scope,
  setup,
  historical,
} from "./payoutAdoptionTestHelpers.js";
it("imports a verified historical manual payout with exact source allocations", async () => {
  const s = await historical();
  expect(await s.adopt()).toMatchObject({
    status: "adopted",
    claims: [{ historical: true, status: "paid", amount: 1000 }],
  });
  await s.adopt();
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toMatchObject([
    { paidAmount: 600, reservedAmount: 0 },
    { paidAmount: 400, reservedAmount: 0 },
  ]);
});
it("requires explicit historical allocations instead of inferring ownership from balance", async () => {
  const s = await historical();
  expect(await s.adopt({ payouts: [] })).toMatchObject({
    status: "held",
    reason: "historical_allocation_required",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
});
it("rejects unavailable funding without writing any partial import", async () => {
  const s = await historical();
  s.setTransactions(
    s
      .transactions()
      .map((t) =>
        t.source === "py_1"
          ? { ...t, available_on: Math.floor(Date.now() / 1000) + 100 }
          : t,
      ),
  );
  await expect(s.adopt()).rejects.toThrow(/funding/i);
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
  ).toEqual([]);
});
it("holds unrelated history before writing source allocations", async () => {
  const s = await historical();
  s.setTransactions([
    ...s.transactions(),
    { ...s.transactions()[0], id: "txn_unowned", source: "po_unknown" },
  ]);
  expect(await s.adopt()).toMatchObject({
    status: "held",
    reason: "unallocated_history",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSourceAllocations").collect()),
  ).toEqual([]);
});
async function activation() {
  const s = await setup();
  const now = Math.floor(Date.now() / 1000);
  s.setTransactions(
    s
      .transactions()
      .map((t) => ({ ...t, created: now - 100, available_on: now - 50 })),
  );
  let schedule: Record<string, unknown> = {
    interval: "weekly",
    weekly_payout_days: ["monday"],
  };
  const settings = {
    retrieve: vi.fn(async () => ({
      payments: { payouts: { status: "enabled", schedule } },
    })),
    update: vi.fn(
      async (args: {
        payments: { payouts: { schedule: Record<string, unknown> } };
      }) => {
        schedule = args.payments.payouts.schedule;
        return { payments: { payouts: { status: "enabled", schedule } } };
      },
    ),
  };
  Object.assign(s.provider, {
    v2: {
      core: {
        accounts: {
          retrieve: vi.fn(async () => ({
            id: scope.accountId,
            dashboard: "none",
            identity: { country: "US" },
          })),
        },
      },
    },
    balanceSettings: settings,
  });
  const { PayoutPolicyClient } = await import("../payoutPolicy.js");
  const client = new PayoutPolicyClient(
    component,
    () => s.provider as unknown as Stripe,
  );
  const opts = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    operationKey: "activate",
    expectedRevision: 0,
    mode: "custom" as const,
    thresholds: [{ currency: "usd", amount: 1000 }],
    consent: true as const,
    adoptExistingBalance: true as const,
  };
  return { ...s, client, settings, opts };
}
it("explicit funded activation verifies complete history, then releases through the public package", async () => {
  const s = await activation();
  expect(await s.client.prepare(s.ctx, s.opts)).toMatchObject({
    status: "prepared",
    operation: { adoption: { oldestHeldAt: expect.any(Number) } },
  });
  expect(
    await s.client.apply(s.ctx, { ...scope, operationKey: "activate" }),
  ).toMatchObject({ status: "ready" });
  expect(await s.client.release(s.ctx, scope)).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1000 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
});
it("new unallocated provider history before a delayed attempt cancels activation safely", async () => {
  const s = await activation();
  await s.client.prepare(s.ctx, s.opts);
  s.setTransactions([
    ...s.transactions(),
    {
      ...s.transactions()[0],
      id: "txn_unknown",
      source: "py_unknown",
      amount: 10,
      net: 10,
    },
  ]);
  expect(
    await s.client.apply(s.ctx, { ...scope, operationKey: "activate" }),
  ).toMatchObject({
    status: "migration_required",
    adoptionReason: "unallocated_history",
  });
  expect(s.settings.update).not.toHaveBeenCalled();
  expect(await s.client.get(s.ctx, scope)).toMatchObject({
    mode: "stripe_managed",
    status: "ready",
  });
});
it("funded activation remains explicit", async () => {
  const s = await activation();
  expect(
    await s.client.prepare(s.ctx, {
      ...s.opts,
      adoptExistingBalance: undefined,
    }),
  ).toMatchObject({ status: "migration_required", reason: "existing_balance" });
  expect(s.settings.update).not.toHaveBeenCalled();
});
it("cannot restart the holding period for already-expired funds", async () => {
  const s = await activation();
  s.setTransactions(
    s.transactions().map((t) => ({ ...t, created: 100, available_on: 200 })),
  );
  expect(await s.client.prepare(s.ctx, s.opts)).toMatchObject({
    status: "migration_required",
    adoptionReason: "holding_deadline_expired",
  });
  expect(await s.client.get(s.ctx, scope)).toMatchObject({
    mode: "stripe_managed",
    status: "ready",
    revision: 0,
  });
  expect(s.settings.update).not.toHaveBeenCalled();
});
