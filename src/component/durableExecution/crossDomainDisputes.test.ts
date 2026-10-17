// @vitest-environment edge-runtime
import { anyApi, componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { fixture, scope, wire } from "../../testing/crossDomain/fixture.js";
const nested = componentsGeneric().betterStripe;
it("caps overlapping refund/dispute principal and revises only the fee after a won dispute", async () => {
  const t = fixture();
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "original-sale",
  });
  await t.action(anyApi.host.funding, { requestKey: "parallel-funding" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  wire.refunded = true;
  wire.dispute = "lost";
  const args = {
    requestKey: "refund-and-lost-dispute",
    expectedRevision: -1,
    rollback: { groupKey: "settlement:a", expectedRevision: -1 },
  };
  const lost = await t.mutation(anyApi.host.costs, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const ref = {
    ...scope(),
    operationId: lost.operationId,
    version: lost.version,
  };
  const original = await t.query(
    nested.processingCostReconciliation.queries.get,
    ref,
  );
  expect(original).toMatchObject({
    status: "completed",
    result: {
      claim: { amountDue: 45, revision: 0 },
      rollbackClaim: { amountDue: 60, revision: 0 },
    },
  });
  const snapshot = await t.query(
    nested.processingCostReconciliation.queries.snapshot,
    ref,
  );
  expect(snapshot.result?.observation).toMatchObject({
    principalReturned: 1000,
    disputeFees: 15,
    originalProcessingFee: 30,
    provenance: { invoiceId: "in_original", stripePriceId: "price_original" },
  });
  const reads = wire.calls.length;
  expect(await t.mutation(anyApi.host.costs, args)).toEqual(original);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(wire.calls).toHaveLength(reads);
  wire.dispute = "won";
  const wonArgs = {
    ...args,
    requestKey: "dispute-won",
    expectedRevision: 0,
    rollback: { groupKey: "settlement:a", expectedRevision: 0 },
  };
  const won = await t.mutation(anyApi.host.costs, wonArgs);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.processingCostReconciliation.queries.get, {
      ...scope(),
      operationId: won.operationId,
      version: won.version,
    }),
  ).toMatchObject({
    status: "completed",
    result: {
      claim: { amountDue: 30, revision: 1 },
      rollbackClaim: { amountDue: 60, revision: 1 },
    },
  });
  expect(
    await t.query(nested.processingCostReconciliation.queries.get, ref),
  ).toEqual(original);
  expect(
    await t.query(nested.costRecovery.queries.balance, scope()),
  ).toMatchObject({
    amountDue: 150,
    collectedAmount: 60,
    outstanding: 90,
    reservedAmount: 0,
  });
  const finalReads = wire.calls.length;
  expect(await t.mutation(anyApi.host.costs, wonArgs)).toMatchObject({
    operationId: won.operationId,
    version: won.version,
    status: "completed",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(wire.calls).toHaveLength(finalReads);
  expect(
    wire.calls.filter((r) => r.method === "POST" && r.path === "/v1/transfers"),
  ).toHaveLength(1);
  expect(
    (await t.run((ctx) => ctx.db.query("reports").take(10))).filter(
      (r) => r.domain === "cost",
    ),
  ).toHaveLength(2);
});
