// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import { setup, wire } from "../../test/store-balance-fixtures";

it("reconciles a legacy provider success without re-preparing or rewriting the original row", async () => {
  const f = await setup();
  wire.enabled = true;
  wire.methodOwner = "acct_store";
  await f.t.mutation(internal.storeBalance.funding.internal.mutations.save, {
    sellerId: f.sellerId,
    subscriptionId: "sub_store",
    enabled: false,
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
    consentAt: 123,
    operationVersion: 7,
    operationPending: true,
    targetEnabled: true,
  });
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: true,
    consent: true,
  });
  expect(wire.requests.every((r) => r.method === "GET")).toBe(true);
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: true, status: "idle" });
  expect(
    await f.t.query(internal.storeBalance.funding.internal.queries.read, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({
    enabled: false,
    operationPending: true,
    operationVersion: 7,
    consentAt: 123,
    componentMigration: { state: "active" },
    previousPaymentMethodId: "pm_card",
  });
});
it("keeps legacy pending identity and rejects opposite or stale completion during compatibility", async () => {
  const f = await setup();
  const refs = internal.storeBalance.funding.internal.mutations;
  await f.t.mutation(refs.save, {
    sellerId: f.sellerId,
    subscriptionId: "sub_store",
    enabled: false,
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
    consentAt: 123,
  });
  const args = { sellerId: f.sellerId, enabled: true, consent: true as const };
  const first = (await f.t.mutation(refs.begin, args))!;
  expect(await f.t.mutation(refs.begin, args)).toEqual(first);
  await expect(
    f.t.mutation(refs.begin, { sellerId: f.sellerId, enabled: false }),
  ).rejects.toThrow(/pending/);
  await f.t.mutation(refs.finish, {
    sellerId: f.sellerId,
    enabled: true,
    version: first.version,
  });
  const next = (await f.t.mutation(refs.begin, {
    sellerId: f.sellerId,
    enabled: false,
  }))!;
  expect(next.version).toBeGreaterThan(first.version);
  await expect(
    f.t.mutation(refs.finish, {
      sellerId: f.sellerId,
      enabled: true,
      version: first.version,
    }),
  ).rejects.toThrow(/changed/);
});
