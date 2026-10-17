// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const scope = { accountId: "acct_owner", scopeKey: "opaque-scope" };
const stripeSubscriptionId = "sub_original";
const providerApiVersion = "2026-06-30.preview";
const original = {
  customerAccount: scope.accountId,
  stripeSubscriptionId,
  previousPaymentMethodId: "pm_original",
  previousPaymentMethodTypes: ["card"],
};
const identity = { ...scope, stripeSubscriptionId, providerApiVersion };
const conflict = {
  status: "conflict",
  reason: "identity_changed",
  retryable: false,
};
async function fixture() {
  const t = convexTest(schema, modules);
  const intent = await t.mutation(mutation("prepare"), {
    ...scope,
    preparation: original,
    consent: true,
    consentAt: 100,
    consentReference: "original-consent",
    providerApiVersion,
    requestKey: "prepare-once",
  });
  const read = (args: typeof identity = identity) => {
    return t.query(
      makeFunctionReference<"query">(
        "balanceFunding/queries:readScopePreparation",
      ),
      args,
    );
  };
  return { t, intent, read };
}

it("finds the canonical capture before any retry can recapture provider settings", async () => {
  const s = await fixture();
  expect(await s.read()).toMatchObject({
    ...scope,
    preparation: original,
    verified: false,
    consentAt: 100,
    consentReference: "original-consent",
    providerApiVersion,
    activeOperationId: s.intent.operation.operationId,
  });
});

it("binds server-only lookup to owner scope, subscription and immutable API version", async () => {
  const s = await fixture();
  expect(await s.read({ ...identity, scopeKey: "alias" })).toEqual(conflict);
  expect(
    await s.read({ ...identity, stripeSubscriptionId: "sub_foreign" }),
  ).toBeNull();
  expect(
    await s.read({ ...identity, providerApiVersion: "changed-version" }),
  ).toEqual(conflict);
});

it("retains the original capture while an uncertain effect holds its reservation", async () => {
  const s = await fixture();
  await s.t.mutation(mutation("start"), s.intent.operation);
  await s.t.mutation(mutation("markUnknown"), s.intent.operation);
  expect(await s.read()).toMatchObject({
    preparation: original,
    activeOperationId: s.intent.operation.operationId,
    verified: false,
  });
  const safe = await s.t.query(
    makeFunctionReference<"query">("balanceFunding/queries:getPreparation"),
    { ...s.intent.operation, stripeSubscriptionId },
  );
  expect(safe).toEqual({ status: "unknown", operation: s.intent.operation });
  expect(JSON.stringify(safe)).not.toContain("pm_original");
  expect(JSON.stringify(safe)).not.toContain("original-consent");
});

it("rejects invalid server scope without returning restoration data", async () => {
  const s = await fixture();
  expect(await s.read({ ...identity, scopeKey: "" })).toEqual({
    status: "rejected",
    reason: "invalid_scope",
    retryable: false,
  });
});
