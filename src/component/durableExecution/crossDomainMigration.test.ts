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
it("preserves both legacy ledgers when new recovery collects an imported opening balance", async () => {
  const t = fixture();
  const fundingImport = {
    accountId: "acct_a",
    scopeKey: "funding:a",
    sourceKey: "legacy:funding:original",
    preparation: {
      customerAccount: "acct_a",
      stripeSubscriptionId: "sub_a",
      paymentMethodId: "pm_balance_a",
      previousPaymentMethodId: "pm_card_a",
      previousPaymentMethodTypes: [],
    },
    consentAt: 123,
    consentReference: "original-consent",
    providerApiVersion: "2026-09-30.preview",
    enabled: false,
    operationVersion: 7,
    pending: {
      enabled: true,
      providerKey: "original-legacy-apply-key",
      requestKey: "original-legacy-request",
    },
  };
  const imported = await t.mutation(
    nested.balanceFunding.mutations.importPreparation,
    fundingImport,
  );
  const opening = {
    ...scope(),
    claimKey: "legacy:cost",
    sourceChargeId: "ch_legacy",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 100,
    revision: 4,
    operationKey: "legacy:collection",
    collectedAmount: 25,
  };
  await t.mutation(nested.costRecovery.mutations.importClaim, opening);
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  const sale = await t.mutation(anyApi.host.startRecovery, {
    name: "a",
    kind: "settlement",
    requestKey: "collect-openings",
  });
  expect(
    await t.action(anyApi.host.funding, { requestKey: "must-not-reprepare" }),
  ).toMatchObject({ status: "conflict" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.recoveryWorkflow.queries.get, {
      ...scope(),
      groupKey: "settlement:a",
      operationId: sale.operationId,
      version: sale.version,
    }),
  ).toMatchObject({ status: "completed" });
  expect(
    await t.mutation(nested.costRecovery.mutations.importClaim, opening),
  ).toMatchObject({
    collectedAmount: 100,
    revision: 4,
    outstanding: 0,
    openingCollection: {
      collectedAmount: 25,
      operationKey: "legacy:collection",
    },
  });
  expect(
    await t.mutation(
      nested.balanceFunding.mutations.importPreparation,
      fundingImport,
    ),
  ).toEqual(imported);
  const saved = await t.query(
    nested.balanceFunding.queries.readScopePreparation,
    { ...fundingScope(), providerApiVersion: "2026-09-30.preview" },
  );
  expect(saved).toMatchObject({
    operationVersion: 7,
    startsPaused: true,
    enabled: false,
    preparation: { previousPaymentMethodTypes: [] },
  });
  expect(
    await t.query(nested.balanceFunding.queries.inspectOperation, {
      ...imported.operation,
      stripeSubscriptionId: "sub_a",
    }),
  ).toMatchObject({
    state: "unknown",
    providerKeys: {
      enable: "original-legacy-apply-key:enable",
      disable: "original-legacy-apply-key:disable",
    },
  });
  expect(
    wire.calls.filter((r) => r.method === "POST").map((r) => r.path),
  ).toEqual(["/v1/transfers"]);
  expect(wire.transfers[0].amount).toBe(765);
  await expect(
    t.mutation(nested.balanceFunding.mutations.importPreparation, {
      ...fundingImport,
      preparation: {
        ...fundingImport.preparation,
        previousPaymentMethodTypes: null,
      },
    }),
  ).rejects.toThrow();
});
it("allows only one racing refund revision to commit while funding completes independently", async () => {
  const t = fixture();
  wire.refunded = true;
  const first = await t.mutation(anyApi.host.costs, {
    requestKey: "refund-event-a",
    expectedRevision: -1,
  });
  const competing = await t.mutation(anyApi.host.costs, {
    requestKey: "refund-event-b",
    expectedRevision: -1,
  });
  await t.action(anyApi.host.funding, { requestKey: "parallel-funding" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const states = await Promise.all(
    [first, competing].map((op) =>
      t.query(nested.processingCostReconciliation.queries.get, {
        ...scope(),
        operationId: op.operationId,
        version: op.version,
      }),
    ),
  );
  expect(states.map((s) => s.status).sort()).toEqual(["completed", "conflict"]);
  expect(
    await t.query(nested.costRecovery.queries.claim, {
      claimKey: "cost:pi_source",
    }),
  ).toMatchObject({ amountDue: 30, revision: 0 });
  expect(
    (await t.run((ctx) => ctx.db.query("reports").take(10))).filter(
      (r) => r.domain === "cost",
    ),
  ).toHaveLength(1);
  expect(
    (
      await t.query(nested.balanceFunding.queries.readScopePreparation, {
        ...fundingScope(),
        providerApiVersion: "2026-09-30.preview",
      })
    ).verified,
  ).toBe(true);
  const requests = wire.calls.length;
  await expect(
    t.query(nested.processingCostReconciliation.queries.get, {
      ...scope("b"),
      operationId: first.operationId,
      version: first.version,
    }),
  ).rejects.toThrow();
  await expect(
    t.query(nested.processingCostReconciliation.queries.get, {
      ...scope(),
      currency: "eur",
      operationId: first.operationId,
      version: first.version,
    }),
  ).rejects.toThrow();
  expect(wire.calls).toHaveLength(requests);
  expect(
    wire.calls.some(
      (r) =>
        r.method === "POST" &&
        r.path !== "/v1/payment_methods" &&
        !r.path.endsWith("/attach"),
    ),
  ).toBe(false);
});
