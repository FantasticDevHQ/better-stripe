// @vitest-environment edge-runtime
import { anyApi, componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import {
  fixture,
  scope,
  fundingScope,
  wire,
} from "../../testing/crossDomain/fixture.js";
const nested = componentsGeneric().betterStripe;
const fundingRef = (op: { operationId: string; version: number }) => ({
  operationId: op.operationId,
  version: op.version,
});
const groupRef = (op: { operationId: string; version: number }) => ({
  ...scope(),
  groupKey: "settlement:a",
  operationId: op.operationId,
  version: op.version,
});
const prep = (t: ReturnType<typeof fixture>) =>
  t.query(nested.balanceFunding.queries.readScopePreparation, {
    ...fundingScope(),
    providerApiVersion: "2026-09-30.preview",
  });
const posts = (path: string) =>
  wire.calls.filter((r) => r.method === "POST" && r.path === path);
it("holds competing recovery and funding identities while unrelated domains complete", async () => {
  const t = fixture();
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  expect(
    await t.mutation(anyApi.host.prepareRecovery, {
      name: "a",
      kind: "invoice",
      amount: 60,
    }),
  ).toMatchObject({ status: "conflict", reason: "scope_busy" });
  const funding = await t.action(anyApi.host.funding, {
    requestKey: "funding",
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "sale",
    affiliate: true,
  });
  expect(
    (
      await t.mutation(anyApi.host.startRecovery, {
        name: "a",
        kind: "settlement",
        requestKey: "alias",
        affiliate: true,
      })
    ).operationId,
  ).toBe(sale.operationId);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const captured = await prep(t);
  wire.loseApply = true;
  const applying = await t.action(anyApi.host.apply, {
    preparationId: captured._id,
    enabled: true,
    requestKey: "enable",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (
      await t.query(nested.balanceFunding.queries.getOperation, {
        ...applying.operation,
        stripeSubscriptionId: "sub_a",
      })
    ).state,
  ).toBe("unknown");
  expect(
    await t.action(anyApi.host.apply, {
      preparationId: captured._id,
      enabled: false,
      requestKey: "opposite",
    }),
  ).toMatchObject({ status: "conflict" });
  await t.action(anyApi.host.fundingControl, {
    ...fundingRef(applying.operation),
    command: "resume",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await prep(t)).enabled).toBe(true);
  expect(posts("/v1/subscriptions/sub_a")).toHaveLength(1);
  expect(posts("/v1/transfers").map((r) => r.key)).toHaveLength(2);
  expect(wire.transfers.map((t) => t.amount)).toEqual([740, 100]);
  expect(
    (
      await t.query(nested.balanceFunding.queries.getPreparation, {
        ...funding.operation,
        stripeSubscriptionId: "sub_a",
      })
    ).status,
  ).toBe("prepared");
});
it("cancels before dispatch without releasing reserved recovery or creating provider effects", async () => {
  const t = fixture();
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  const funding = await t.action(anyApi.host.funding, {
    requestKey: "cancel-funding",
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "cancel-sale",
  });
  await t.action(anyApi.host.fundingControl, {
    ...fundingRef(funding.operation),
    command: "cancel",
  });
  await t.mutation(
    nested.recoveryWorkflow.mutations.requestCancel,
    groupRef(sale),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(posts("/v1/payment_methods")).toEqual([]);
  expect(posts("/v1/transfers")).toEqual([]);
  expect(
    await t.query(nested.recoveryWorkflow.queries.get, groupRef(sale)),
  ).toMatchObject({ status: "canceled" });
  expect(
    await t.query(nested.costRecovery.queries.group, {
      groupKey: "settlement:a",
    }),
  ).toMatchObject({ status: "sealed", amount: 60 });
  expect(
    await t.query(nested.costRecovery.queries.claim, { claimKey: "debt:a" }),
  ).toMatchObject({ reservedAmount: 60, collectedAmount: 0 });
});
it("keeps a known in-flight collection after cancellation without a second transfer", async () => {
  const t = fixture();
  await t.action(anyApi.host.funding, { requestKey: "funding" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  let release!: () => void;
  wire.transferGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "inflight",
  });
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  try {
    await vi.waitFor(() => expect(posts("/v1/transfers")).toHaveLength(1));
    await t.mutation(
      nested.recoveryWorkflow.mutations.requestCancel,
      groupRef(sale),
    );
    expect((await prep(t)).verified).toBe(true);
  } finally {
    release();
    await drain;
  }
  expect(
    await t.query(nested.recoveryWorkflow.queries.get, groupRef(sale)),
  ).toMatchObject({
    status: "completed",
    cancelRequested: true,
    outcome: "collect",
  });
  expect(
    await t.query(nested.costRecovery.queries.claim, { claimKey: "debt:a" }),
  ).toMatchObject({ collectedAmount: 60, reservedAmount: 0 });
  expect(posts("/v1/transfers")).toHaveLength(1);
});
it("never dispatches a changed-version or cleaned-history funding operation while recovery succeeds", async () => {
  const t = fixture();
  wire.loseCreate = true;
  const funding = await t.action(anyApi.host.funding, {
    requestKey: "unknown-create",
  });
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "parallel-sale",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const reference = {
    ...funding.operation,
    stripeSubscriptionId: "sub_a",
    providerApiVersion: "2026-09-30.preview",
    definitionVersion: "balance-funding/v1",
  };
  expect(
    await t.mutation(nested.balanceFunding.mutations.resumeWorkflow, {
      ...reference,
      definitionVersion: "balance-funding/v2",
    }),
  ).toMatchObject({ status: "conflict" });
  expect(
    await t.mutation(nested.balanceFunding.mutations.resumeWorkflow, {
      ...reference,
      providerApiVersion: "2026-06-30.preview",
    }),
  ).toMatchObject({ status: "conflict" });
  await t.mutation(nested.crossDomainFixture.cleanFundingHistory, {
    operationId: funding.operation.operationId,
  });
  expect(
    await t.action(anyApi.host.fundingControl, {
      ...fundingRef(funding.operation),
      command: "resume",
    }),
  ).toMatchObject({ status: "unknown", reason: "history_incomplete" });
  expect((await prep(t)).preparation.previousPaymentMethodId).toBe("pm_card_a");
  expect(
    await t.query(nested.recoveryWorkflow.queries.get, groupRef(sale)),
  ).toMatchObject({ status: "completed" });
  expect(posts("/v1/payment_methods")).toHaveLength(1);
  expect(posts("/v1/transfers")).toHaveLength(1);
});
