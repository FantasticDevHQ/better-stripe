// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_owner", scopeKey: "opaque" };
const args = {
  ...scope,
  preparation: {
    customerAccount: scope.accountId,
    stripeSubscriptionId: "sub_prepare",
    previousPaymentMethodId: null,
    previousPaymentMethodTypes: null,
  },
  consent: true,
  consentAt: 123,
  consentReference: "signed-consent",
  providerApiVersion: "2026-06-30.preview",
  requestKey: "prepare-1",
};
it("persists original settings and stable create/attach keys before provisioning", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), args);
  expect(first.status).toBe("accepted");
  expect(await t.mutation(m("prepare"), args)).toEqual(first);
  const op = await t.query(q("inspectOperation"), {
    ...first.operation,
    stripeSubscriptionId: "sub_prepare",
  });
  expect(op.kind).toBe("prepare");
  expect(op.providerKeys.create).toBe(`${op.providerKey}:create`);
  expect(op.providerKeys.attach).toBe(`${op.providerKey}:attach`);
  const saved = await t.query(q("readPreparation"), {
    ...{
      ...scope,
      preparationId: op.preparationId,
    },
    stripeSubscriptionId: "sub_prepare",
  });
  expect(saved.preparation.previousPaymentMethodId).toBe(null);
  expect(saved.preparation.previousPaymentMethodTypes).toBe(null);
  expect(saved.preparation.paymentMethodId).toBeUndefined();
  expect(
    await t.mutation(m("begin"), {
      ...scope,
      preparationId: op.preparationId,
      enabled: true,
      consent: true,
      requestKey: "too-early",
    }),
  ).toEqual({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
  const preparation = { ...args.preparation, paymentMethodId: "pm_created" };
  await t.mutation(m("finishPreparation"), {
    ...first.operation,
    preparation,
    providerApiVersion: args.providerApiVersion,
  });
  expect(await t.mutation(m("prepare"), args)).toEqual(first);
  expect(
    (
      await t.query(q("inspectOperation"), {
        ...first.operation,
        stripeSubscriptionId: "sub_prepare",
      })
    ).state,
  ).toBe("succeeded");
  const next = await t.mutation(m("begin"), {
    ...scope,
    preparationId: op.preparationId,
    enabled: true,
    consent: true,
    requestKey: "enable",
  });
  expect(next.operation.version).toBe(2);
});
it("holds uncertain provisioning against new identities and protects captured restoration", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), args);
  await t.mutation(m("start"), first.operation);
  await t.mutation(m("markUnknown"), first.operation);
  expect(
    await t.mutation(m("prepare"), { ...args, requestKey: "retry" }),
  ).toEqual(first);
  expect(
    await t.mutation(m("prepare"), {
      ...args,
      requestKey: "changed",
      preparation: {
        ...args.preparation,
        previousPaymentMethodId: "pm_changed",
      },
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  await expect(
    t.mutation(m("finishPreparation"), {
      ...first.operation,
      preparation: {
        ...args.preparation,
        paymentMethodId: "pm_created",
        previousPaymentMethodTypes: [],
      },
      providerApiVersion: args.providerApiVersion,
    }),
  ).rejects.toThrow(/restoration|receipt|identity/i);
  await expect(
    t.mutation(m("finishPreparation"), {
      ...first.operation,
      preparation: { ...args.preparation, paymentMethodId: "pm_created" },
      providerApiVersion: "different",
    }),
  ).rejects.toThrow(/version|identity/i);
});
it("binds a new request for an already verified preparation to its original operation", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), args);
  await t.mutation(m("finishPreparation"), {
    ...first.operation,
    preparation: { ...args.preparation, paymentMethodId: "pm_created" },
    providerApiVersion: args.providerApiVersion,
  });
  const repeat = { ...args, requestKey: "another-prepare-request" };
  expect(await t.mutation(m("prepare"), repeat)).toEqual(first);
  expect(
    await t.mutation(m("prepare"), {
      ...repeat,
      accountId: "foreign",
      preparation: { ...args.preparation, customerAccount: "foreign" },
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
