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
const groupRef = (
  op: { operationId: string; version: number },
  name = "a",
  kind = "settlement",
) => ({
  ...scope(name),
  groupKey: `${kind}:${name}`,
  operationId: op.operationId,
  version: op.version,
});
const preparation = (t: ReturnType<typeof fixture>) =>
  t.query(nested.balanceFunding.queries.readScopePreparation, {
    ...fundingScope(),
    providerApiVersion: "2026-09-30.preview",
  });
const status = (
  t: ReturnType<typeof fixture>,
  op: { operationId: string; version: number },
  name = "a",
  kind = "settlement",
) =>
  t.query(
    nested.recoveryWorkflow.queries.get,
    groupRef({ operationId: op.operationId, version: op.version }, name, kind),
  );
const posts = (path: string) =>
  wire.calls.filter((r) => r.method === "POST" && r.path === path);
it("keeps unrelated recovery progressing through the shared runtime while funding provisioning is in flight", async () => {
  const t = fixture();
  let release!: () => void;
  wire.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "b",
    kind: "invoice",
    amount: 25,
  });
  const funding = await t.action(anyApi.host.funding, {
    requestKey: "funding-once",
  });
  expect(
    await t.action(anyApi.host.funding, { requestKey: "funding-once" }),
  ).toEqual(funding);
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "sale-once",
  });
  const invoice = await t.mutation(anyApi.host.startRecovery, {
    name: "b",
    kind: "invoice",
    requestKey: "invoice-once",
  });
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  try {
    await vi.waitFor(() =>
      expect(posts("/v1/payment_methods")).toHaveLength(1),
    );
    await vi.waitFor(() => expect(wire.items).toHaveLength(1));
    wire.invoicePaid = true;
    await t.mutation(
      nested.recoveryWorkflow.mutations.resume,
      groupRef(invoice, "b", "invoice"),
    );
    await vi.waitFor(async () =>
      expect(await status(t, sale)).toMatchObject({ status: "completed" }),
    );
    await vi.waitFor(async () =>
      expect(await status(t, invoice, "b", "invoice")).toMatchObject({
        status: "completed",
      }),
    );
    expect((await preparation(t)).verified).toBe(false);
    expect(posts("/v1/transfers")).toHaveLength(1);
    expect(posts("/v1/invoiceitems")).toHaveLength(1);
  } finally {
    release();
    await drain;
  }
  expect((await preparation(t)).verified).toBe(true);
  expect(wire.calls.every((r) => r.authenticated)).toBe(true);
  expect(
    wire.calls
      .filter(
        (r) =>
          r.path.includes("payment_methods") ||
          r.path.includes("subscriptions"),
      )
      .every((r) => r.version === "2026-09-30.preview"),
  ).toBe(true);
  expect(
    wire.calls
      .filter(
        (r) =>
          !r.path.includes("payment_methods") &&
          !r.path.includes("subscriptions"),
      )
      .every((r) => r.version === "2026-09-30.endive"),
  ).toBe(true);
});
it("recovers transfer success and a failed host projection without replaying money or disturbing funding history", async () => {
  const t = fixture();
  wire.loseTransfer = true;
  wire.projectionFailures = 1;
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  const funding = await t.action(anyApi.host.funding, {
    requestKey: "prepare",
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "sale",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(posts("/v1/transfers")).toHaveLength(1);
  expect((await preparation(t)).verified).toBe(true);
  await t.mutation(nested.recoveryWorkflow.mutations.resume, groupRef(sale));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("reports").take(10))).toEqual([]);
  expect(
    (
      await t.query(nested.costRecovery.queries.group, {
        groupKey: "settlement:a",
      })
    ).status,
  ).toBe("collected");
  const providerReads = wire.calls.length;
  await t.mutation(nested.recoveryWorkflow.mutations.resume, groupRef(sale));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await status(t, sale)).toMatchObject({ status: "completed" });
  expect(posts("/v1/transfers")).toHaveLength(1);
  expect(wire.calls).toHaveLength(providerReads);
  const prep = await preparation(t);
  expect(prep.preparation.previousPaymentMethodId).toBe("pm_card_a");
  expect(prep.preparation.previousPaymentMethodTypes).toEqual(["card"]);
  expect(
    (
      await t.query(nested.balanceFunding.queries.getPreparation, {
        ...funding.operation,
        stripeSubscriptionId: "sub_a",
      })
    ).status,
  ).toBe("prepared");
  expect(await t.run((ctx) => ctx.db.query("reports").take(10))).toHaveLength(
    1,
  );
  const journal = JSON.stringify(
    await t.query(nested.crossDomainFixture.journals, {}),
  );
  expect(journal).not.toContain("sk_test_cross_domain_runtime_only");
  expect(journal).not.toContain("private transfer body");
  expect(journal).not.toContain("private database projection");
});
it("replays a refund observation and its collected settlement rollback atomically", async () => {
  const t = fixture();
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "sale-refund",
  });
  await t.action(anyApi.host.funding, { requestKey: "parallel-funding" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await status(t, sale)).toMatchObject({ status: "completed" });
  wire.refunded = true;
  wire.projectionFailures = 1;
  const args = {
    requestKey: "refund-original",
    expectedRevision: -1,
    rollback: { groupKey: "settlement:a", expectedRevision: -1 },
  };
  const first = await t.mutation(anyApi.host.costs, args);
  expect(await t.mutation(anyApi.host.costs, args)).toEqual(first);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const costRef = {
    ...scope(),
    operationId: first.operationId,
    version: first.version,
  };
  expect(
    await t.query(nested.costRecovery.queries.claim, {
      claimKey: "cost:pi_source",
    }),
  ).toBeNull();
  expect(
    await t.query(nested.costRecovery.queries.claim, {
      claimKey: "rollback:settlement:a",
    }),
  ).toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.query("reports").take(10))).filter(
      (r) => r.domain === "cost",
    ),
  ).toHaveLength(0);
  const reads = wire.calls.length;
  await t.mutation(
    nested.processingCostReconciliation.mutations.resume,
    costRef,
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.processingCostReconciliation.queries.get, costRef),
  ).toMatchObject({ status: "completed" });
  expect(
    await t.query(nested.costRecovery.queries.claim, {
      claimKey: "cost:pi_source",
    }),
  ).toMatchObject({ amountDue: 30, revision: 0 });
  expect(
    await t.query(nested.costRecovery.queries.claim, {
      claimKey: "rollback:settlement:a",
    }),
  ).toMatchObject({ amountDue: 60, revision: 0 });
  expect(wire.calls).toHaveLength(reads);
  expect(posts("/v1/transfers")).toHaveLength(1);
  expect((await preparation(t)).verified).toBe(true);
});
