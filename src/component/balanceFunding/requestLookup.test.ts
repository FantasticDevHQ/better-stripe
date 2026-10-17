// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_recover", scopeKey: "recover" };
const original = {
  customerAccount: scope.accountId,
  stripeSubscriptionId: "sub_recover",
  previousPaymentMethodId: "pm_original",
  previousPaymentMethodTypes: ["card"],
};
const prepare = {
  ...scope,
  preparation: original,
  consent: true,
  consentAt: 10,
  consentReference: "consent",
  providerApiVersion: "preview",
  requestKey: "recover-request",
};
const lookup = {
  ...scope,
  stripeSubscriptionId: "sub_recover",
  requestKey: prepare.requestKey,
  providerApiVersion: "preview",
  consent: true,
};
it("recovers a lost prepare response from the original public request without recapturing settings or time", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(m("prepare"), prepare);
  const found = await t.query(q("findPreparationOperation"), lookup);
  expect(found.state).toBe("pending");
  expect(Object.keys(found).sort()).toEqual([
    "accountId",
    "cancelRequested",
    "operationId",
    "scopeKey",
    "state",
    "version",
  ]);
  const operation = {
    accountId: found.accountId,
    scopeKey: found.scopeKey,
    operationId: found.operationId,
    version: found.version,
  };
  await t.mutation(m("finishPreparation"), {
    ...operation,
    preparation: { ...original, paymentMethodId: "pm_balance" },
    providerApiVersion: "preview",
  });
  expect((await t.query(q("findPreparationOperation"), lookup)).state).toBe(
    "succeeded",
  );
  expect(
    (
      await t.query(q("getPreparation"), {
        ...operation,
        stripeSubscriptionId: "sub_recover",
      })
    ).status,
  ).toBe("prepared");
  await expect(
    t.mutation(m("prepare"), { ...prepare, consentAt: 11 }),
  ).resolves.toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("returns null for missing requests and conflicts for changed scope, subscription, API version or consent", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(q("findPreparationOperation"), lookup)).toBeNull();
  await t.mutation(m("prepare"), prepare);
  for (const args of [
    { ...lookup, accountId: "foreign" },
    { ...lookup, scopeKey: "foreign" },
    { ...lookup, stripeSubscriptionId: "foreign" },
    { ...lookup, providerApiVersion: "changed" },
    { ...lookup, consent: false },
  ])
    expect(await t.query(q("findPreparationOperation"), args)).toEqual({
      status: "conflict",
      reason: "identity_changed",
      retryable: false,
    });
  expect(
    await t.query(q("findPreparationOperation"), { ...lookup, requestKey: "" }),
  ).toEqual({ status: "rejected", reason: "invalid_scope", retryable: false });
});
it("rejects apply and foreign request identities instead of returning their operation", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), prepare);
  await t.mutation(m("finishPreparation"), {
    ...first.operation,
    preparation: { ...original, paymentMethodId: "pm_balance" },
    providerApiVersion: "preview",
  });
  const prepared = await t.query(q("getPreparation"), {
    ...first.operation,
    stripeSubscriptionId: "sub_recover",
  });
  await t.mutation(m("begin"), {
    ...scope,
    preparationId: prepared.preparationId,
    enabled: true,
    consent: true,
    requestKey: "apply-request",
  });
  expect(
    await t.query(q("findPreparationOperation"), {
      ...lookup,
      requestKey: "apply-request",
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("recovers unknown and failed intent identities without exposing restoration, keys or preparation IDs", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), prepare);
  await t.mutation(m("start"), first.operation);
  await t.mutation(m("markUnknown"), first.operation);
  const unknown = await t.query(q("findPreparationOperation"), lookup);
  expect(unknown.state).toBe("unknown");
  expect(unknown.operationId).toBe(first.operation.operationId);
  expect(Object.keys(unknown)).not.toContain("preparationId");
  const next = await t.mutation(m("prepare"), {
    ...prepare,
    preparation: { ...original, stripeSubscriptionId: "sub_failed" },
    requestKey: "failed-request",
  });
  await t.mutation(m("failBeforeStart"), {
    ...next.operation,
    failureCode: "unsupported_source",
  });
  const failed = await t.query(q("findPreparationOperation"), {
    ...lookup,
    stripeSubscriptionId: "sub_failed",
    requestKey: "failed-request",
  });
  expect(failed.state).toBe("failed");
  expect(failed.failureCode).toBe("unsupported_source");
  expect(Object.keys(failed).sort()).toEqual([
    "accountId",
    "cancelRequested",
    "failureCode",
    "operationId",
    "scopeKey",
    "state",
    "version",
  ]);
});
