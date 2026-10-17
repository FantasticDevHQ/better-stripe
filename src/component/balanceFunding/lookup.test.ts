// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_lookup", scopeKey: "lookup" };
const preparation = {
  customerAccount: scope.accountId,
  stripeSubscriptionId: "sub_lookup",
  previousPaymentMethodId: "pm_original",
  previousPaymentMethodTypes: ["card"],
};
const args = {
  ...scope,
  preparation,
  consent: true,
  consentAt: 10,
  consentReference: "consent",
  providerApiVersion: "preview",
  requestKey: "prepare",
};
it("only verified preparation exposes its reference, including lost-response replay", async () => {
  const t = convexTest(schema, modules);
  const started = await t.mutation(m("prepare"), args);
  const lookup = {
    ...started.operation,
    stripeSubscriptionId: preparation.stripeSubscriptionId,
  };
  expect(await t.query(q("getPreparation"), lookup)).toEqual({
    status: "pending",
    operation: started.operation,
  });
  await t.mutation(m("start"), started.operation);
  await t.mutation(m("markUnknown"), started.operation);
  expect(await t.query(q("getPreparation"), lookup)).toEqual({
    status: "unknown",
    operation: started.operation,
  });
  await t.mutation(m("finishPreparation"), {
    ...started.operation,
    preparation: { ...preparation, paymentMethodId: "pm_balance" },
    providerApiVersion: args.providerApiVersion,
  });
  const replay = await t.mutation(m("prepare"), args);
  expect(replay).toEqual(started);
  const found = await t.query(q("getPreparation"), lookup);
  expect(found.status).toBe("prepared");
  expect(found.preparationId).toEqual(expect.any(String));
  expect(Object.keys(found).sort()).toEqual([
    "operation",
    "preparationId",
    "status",
    "stripeSubscriptionId",
  ]);
  const accepted = await t.mutation(m("begin"), {
    ...scope,
    preparationId: found.preparationId,
    enabled: true,
    consent: true,
    requestKey: "enable",
  });
  expect(accepted.status).toBe("accepted");
  expect(
    await t.query(q("getPreparation"), {
      ...accepted.operation,
      stripeSubscriptionId: "sub_lookup",
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  const status = await t.query(q("getOperation"), {
    ...started.operation,
    stripeSubscriptionId: "sub_lookup",
  });
  expect(status).toEqual({
    ...started.operation,
    state: "succeeded",
    cancelRequested: false,
  });
});
it("never exposes preparation data for foreign subscription, scope, version or apply operation", async () => {
  const t = convexTest(schema, modules);
  const started = await t.mutation(m("prepare"), args);
  const lookup = {
    ...started.operation,
    stripeSubscriptionId: preparation.stripeSubscriptionId,
  };
  for (const changed of [
    { ...lookup, accountId: "foreign" },
    { ...lookup, scopeKey: "foreign" },
    { ...lookup, stripeSubscriptionId: "foreign" },
    { ...lookup, version: 2 },
  ])
    expect(await t.query(q("getPreparation"), changed)).toEqual({
      status: "conflict",
      reason: "identity_changed",
      retryable: false,
    });
  expect(await t.query(q("getPreparation"), { ...lookup, version: 0 })).toEqual(
    { status: "rejected", reason: "invalid_scope", retryable: false },
  );
  await t.mutation(m("requestCancel"), started.operation);
  expect(await t.query(q("getPreparation"), lookup)).toEqual({
    status: "canceled",
    operation: started.operation,
  });
});
