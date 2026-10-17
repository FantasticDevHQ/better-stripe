// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { api, internal, components } from "../_generated/api";
import { setup, wire } from "../../test/store-balance-fixtures";
const updates = () =>
  wire.requests.filter(
    (r) => r.method === "POST" && r.path.includes("subscriptions"),
  );
it("queues an authorized intent before provider writes, then completes the component workflow", async () => {
  const f = await setup();
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
  ).toMatchObject({ enabled: false, status: "pending" });
  await f.drain();
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: true, status: "idle" });
  expect(updates()).toHaveLength(1);
  expect(
    await f.t.run((ctx) => ctx.db.query("storeBalanceFunding").take(2)),
  ).toEqual([]);
});
it("coalesces duplicate requests, restores the original card, and re-enables with a new apply key", async () => {
  const f = await setup();
  const enable = {
    sellerId: f.sellerId,
    enabled: true,
    consent: true as const,
  };
  await Promise.all([
    f.t.action(api.storeBalance.actions.setFunding, enable),
    f.t.action(api.storeBalance.actions.setFunding, enable),
  ]);
  await f.drain();
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: false,
  });
  await f.drain();
  expect(wire.enabled).toBe(false);
  await f.t.action(api.storeBalance.actions.setFunding, enable);
  await f.drain();
  expect(updates()).toHaveLength(3);
  expect(new Set(updates().map((r) => r.key)).size).toBe(3);
  expect(
    wire.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/payment_methods",
    ),
  ).toHaveLength(1);
});
it("holds an uncertain apply and reconciles its original request without charging twice", async () => {
  const f = await setup();
  wire.loseApply = true;
  const args = { sellerId: f.sellerId, enabled: true, consent: true as const };
  await f.t.action(api.storeBalance.actions.setFunding, args);
  await f.drain();
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: false, status: "held" });
  expect(updates()).toHaveLength(1);
  await f.t.action(api.storeBalance.actions.setFunding, args);
  await f.drain();
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: true, status: "idle" });
  expect(updates()).toHaveLength(1);
});
it("rejects missing consent and foreign subscriptions before provisioning", async () => {
  const f = await setup();
  await expect(
    f.t.action(api.storeBalance.actions.setFunding, {
      sellerId: f.sellerId,
      enabled: true,
    }),
  ).rejects.toThrow(/Authorize|consent/i);
  wire.foreign = true;
  await expect(
    f.t.action(api.storeBalance.actions.setFunding, {
      sellerId: f.sellerId,
      enabled: true,
      consent: true,
    }),
  ).rejects.toThrow(/belong|identity/i);
  expect(wire.requests.every((r) => r.method === "GET")).toBe(true);
});

it("does not resurrect a finished request when a delayed observer binds it", async () => {
  const f = await setup();
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: true,
    consent: true,
  });
  await f.drain();
  const request = (await f.t.run((ctx) =>
    ctx.db.query("storeBalanceRequests").first(),
  ))!;
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: false,
  });
  await f.t.mutation(internal.storeBalance.workflow.internal.requests.bind, {
    requestId: request._id,
    operation: request.operation!,
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceRequests", request._id)),
  ).toMatchObject({ state: "finished" });
  await f.drain();
  expect(wire.enabled).toBe(false);
});
it("reads only verified, idle component funding for invoice collection", async () => {
  const f = await setup();
  const reader = internal.storeBalance.funding.internal.queries.paymentSource;
  expect(await f.t.query(reader, { sellerId: f.sellerId })).toBeNull();
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: true,
    consent: true,
  });
  expect(await f.t.query(reader, { sellerId: f.sellerId })).toBeNull();
  await f.drain();
  expect(await f.t.query(reader, { sellerId: f.sellerId })).toEqual({
    paymentMethodId: "pm_balance",
  });
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: false,
  });
  await f.drain();
  expect(await f.t.query(reader, { sellerId: f.sellerId })).toBeNull();
});

it("reschedules a pending intent and fences an obsolete observer timeout", async () => {
  const f = await setup();
  const args = { sellerId: f.sellerId, enabled: true, consent: true as const };
  await f.t.action(api.storeBalance.actions.setFunding, args);
  const first = (await f.t.run((ctx) =>
    ctx.db.query("storeBalanceRequests").first(),
  ))!;
  await f.t.action(api.storeBalance.actions.setFunding, args);
  const second = (await f.t.run((ctx) =>
    ctx.db.get("storeBalanceRequests", first._id),
  ))!;
  expect(second.observationEpoch).toBeGreaterThan(first.observationEpoch!);
  await f.t.mutation(internal.storeBalance.workflow.internal.requests.expire, {
    requestId: first._id,
    observationEpoch: first.observationEpoch!,
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceRequests", first._id)),
  ).toMatchObject({ state: "pending" });
  await f.drain();
  expect(updates()).toHaveLength(1);
});
it("makes an abandoned observer explicitly retryable while retaining its financial request", async () => {
  const f = await setup();
  const args = { sellerId: f.sellerId, enabled: true, consent: true as const };
  await f.t.action(api.storeBalance.actions.setFunding, args);
  const request = (await f.t.run((ctx) =>
    ctx.db.query("storeBalanceRequests").first(),
  ))!;
  await f.t.mutation(internal.storeBalance.workflow.internal.requests.expire, {
    requestId: request._id,
    observationEpoch: request.observationEpoch!,
  });
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ status: "held" });
  await f.t.action(api.storeBalance.actions.setFunding, args);
  expect(
    (await f.t.run((ctx) => ctx.db.query("storeBalanceRequests").take(2))).map(
      (r) => r._id,
    ),
  ).toEqual([request._id]);
  await f.drain();
  expect(updates()).toHaveLength(1);
});

it("holds an intent if its seller account is replaced after authorization", async () => {
  const f = await setup();
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: true,
    consent: true,
  });
  await f.t.run((ctx) =>
    ctx.db.patch("users", f.sellerId, { stripeAccountId: "acct_replacement" }),
  );
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: false, status: "held" });
  await f.drain();
  expect(updates()).toHaveLength(0);
});

it("shows active preparation as pending while preserving an observer timeout hold", async () => {
  const f = await setup();
  await f.t.action(api.storeBalance.actions.setFunding, {
    sellerId: f.sellerId,
    enabled: true,
    consent: true,
  });
  await f.t.mutation(components.betterStripe.balanceFunding.mutations.prepare, {
    accountId: "acct_store",
    scopeKey: `example:store-balance:${f.sellerId}:sub_store`,
    requestKey: "fixture-active-preparation",
    consent: true,
    consentAt: 123,
    consentReference: "fixture-consent",
    providerApiVersion: "2026-09-30.preview",
    preparation: {
      customerAccount: "acct_store",
      stripeSubscriptionId: "sub_store",
      previousPaymentMethodId: "pm_card",
      previousPaymentMethodTypes: ["card"],
    },
  });
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: false, status: "pending" });
  const request = (await f.t.run((ctx) =>
    ctx.db.query("storeBalanceRequests").first(),
  ))!;
  await f.t.mutation(internal.storeBalance.workflow.internal.requests.expire, {
    requestId: request._id,
    observationEpoch: request.observationEpoch!,
  });
  expect(
    await f.t.query(api.storeBalance.funding.public.queries.state, {
      sellerId: f.sellerId,
    }),
  ).toMatchObject({ enabled: false, status: "held" });
});
