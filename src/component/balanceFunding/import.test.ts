// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_owner", scopeKey: "legacy-owner" };
const record = {
  ...scope,
  sourceKey: "legacy-row-1",
  preparation: {
    customerAccount: scope.accountId,
    stripeSubscriptionId: "sub_legacy",
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
  },
  consentAt: 100,
  consentReference: "legacy-consent",
  providerApiVersion: "2026-06-30.preview",
  enabled: true,
  operationVersion: 7,
  pending: {
    enabled: false,
    providerKey: "example_balance_sub_legacy_7",
    requestKey: "legacy-disable",
  },
};
it("imports pending legacy settings and exact provider keys once", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("importPreparation"), record);
  expect(await t.mutation(m("importPreparation"), record)).toEqual(saved);
  const setting = await t.query(q("readPreparation"), {
    ...{
      ...scope,
      preparationId: saved.preparationId,
    },
    stripeSubscriptionId: "sub_legacy",
  });
  expect(setting.preparation).toEqual(record.preparation);
  expect(setting.enabled).toBe(true);
  expect(setting.operationVersion).toBe(7);
  const operation = await t.query(q("inspectOperation"), {
    ...saved.operation,
    stripeSubscriptionId: "sub_legacy",
  });
  expect(operation.state).toBe("unknown");
  expect(operation.providerKeys).toEqual({
    enable: "example_balance_sub_legacy_7:enable",
    disable: "example_balance_sub_legacy_7:disable",
  });
  expect(
    await t.mutation(m("begin"), {
      ...scope,
      preparationId: saved.preparationId,
      enabled: false,
      requestKey: "legacy-disable",
    }),
  ).toEqual({ status: "accepted", operation: saved.operation });
  await t.mutation(m("finish"), {
    ...saved.operation,
    enabled: false,
    receipt: {
      customerAccount: scope.accountId,
      stripeSubscriptionId: "sub_legacy",
      paymentMethodId: "pm_card",
      paymentMethodTypes: ["card"],
      providerApiVersion: record.providerApiVersion,
    },
  });
  expect(await t.mutation(m("importPreparation"), record)).toEqual(saved);
  expect(
    (
      await t.query(q("readPreparation"), {
        ...{
          ...scope,
          preparationId: saved.preparationId,
        },
        stripeSubscriptionId: "sub_legacy",
      })
    ).enabled,
  ).toBe(false);
});
it("rejects conflicting import payloads and preserves saved restoration", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("importPreparation"), record);
  for (const changed of [
    {
      ...record,
      preparation: {
        ...record.preparation,
        previousPaymentMethodId: "pm_other",
      },
    },
    { ...record, pending: { ...record.pending, providerKey: "new-key" } },
    { ...record, scopeKey: "other" },
    { ...record, sourceKey: "other-source", operationVersion: 8 },
  ])
    await expect(t.mutation(m("importPreparation"), changed)).rejects.toThrow(
      /conflict|identity|existing/i,
    );
  expect(
    (
      await t.query(q("readPreparation"), {
        ...{
          ...scope,
          preparationId: saved.preparationId,
        },
        stripeSubscriptionId: "sub_legacy",
      })
    ).preparation.previousPaymentMethodId,
  ).toBe("pm_card");
});
it("imports interrupted legacy preparation with its original create and attach keys", async () => {
  const t = convexTest(schema, modules);
  const { paymentMethodId: _paymentMethodId, ...original } = record.preparation;
  const legacy = {
    ...record,
    preparation: original,
    enabled: false,
    pending: {
      enabled: false,
      kind: "prepare",
      providerKey: "example_balance_prepare_sub_legacy",
      requestKey: "legacy-prepare",
    },
  };
  const saved = await t.mutation(m("importPreparation"), legacy);
  const op = await t.query(q("inspectOperation"), {
    ...saved.operation,
    stripeSubscriptionId: "sub_legacy",
  });
  expect(op.kind).toBe("prepare");
  expect(op.providerKeys.create).toBe(
    "example_balance_prepare_sub_legacy:create",
  );
  expect(op.providerKeys.attach).toBe(
    "example_balance_prepare_sub_legacy:attach",
  );
  expect(
    await t.query(q("getPreparation"), {
      ...saved.operation,
      stripeSubscriptionId: "sub_legacy",
    }),
  ).toEqual({ status: "unknown", operation: saved.operation });
  expect(
    await t.mutation(m("prepare"), {
      ...scope,
      preparation: original,
      consent: true,
      consentAt: record.consentAt,
      consentReference: record.consentReference,
      providerApiVersion: record.providerApiVersion,
      requestKey: "legacy-prepare",
    }),
  ).toEqual({ status: "accepted", operation: saved.operation });
  await t.mutation(m("finishPreparation"), {
    ...saved.operation,
    preparation: record.preparation,
    providerApiVersion: record.providerApiVersion,
  });
  expect(
    (
      await t.query(q("getPreparation"), {
        ...saved.operation,
        stripeSubscriptionId: "sub_legacy",
      })
    ).status,
  ).toBe("prepared");
});
it("rolls back an import whose request identity already belongs to another scope", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("importPreparation"), record);
  await expect(
    t.mutation(m("importPreparation"), {
      ...record,
      sourceKey: "row2",
      scopeKey: "other",
      preparation: { ...record.preparation, stripeSubscriptionId: "sub_other" },
    }),
  ).rejects.toThrow(/request identity/i);
  expect(
    (await t.run((ctx) => ctx.db.query("balanceFundingPreparations").take(10)))
      .length,
  ).toBe(1);
});
it("requires verification before applying an imported unresolved preparation", async () => {
  const t = convexTest(schema, modules);
  const legacy = {
    ...record,
    enabled: false,
    pending: {
      enabled: false,
      kind: "prepare",
      providerKey: "example_balance_prepare_sub_legacy",
      requestKey: "legacy-prepare",
    },
  };
  const saved = await t.mutation(m("importPreparation"), legacy);
  await t.mutation(m("setStartsPaused"), {
    ...scope,
    preparationId: saved.preparationId,
    stripeSubscriptionId: "sub_legacy",
    paused: false,
  });
  expect(
    await t.mutation(m("begin"), {
      ...scope,
      preparationId: saved.preparationId,
      enabled: false,
      requestKey: "disable",
    }),
  ).toEqual({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
});
