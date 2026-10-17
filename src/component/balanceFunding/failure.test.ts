// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_failure", scopeKey: "failure" };
const original = {
  customerAccount: scope.accountId,
  stripeSubscriptionId: "sub_failure",
  previousPaymentMethodId: null,
  previousPaymentMethodTypes: null,
};
const args = {
  ...scope,
  preparation: original,
  consent: true,
  consentAt: 10,
  consentReference: "consent",
  providerApiVersion: "preview",
  requestKey: "prepare",
};
it("records safe terminal failure only before execution and keeps failed lookup free of preparation data", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), args);
  await t.mutation(m("failBeforeStart"), {
    ...first.operation,
    failureCode: "policy_invalid",
  });
  const lookup = { ...first.operation, stripeSubscriptionId: "sub_failure" };
  expect(await t.query(q("getOperation"), lookup)).toEqual({
    ...first.operation,
    state: "failed",
    cancelRequested: false,
    failureCode: "policy_invalid",
  });
  expect(await t.query(q("getPreparation"), lookup)).toEqual({
    status: "failed",
    operation: first.operation,
    failureCode: "policy_invalid",
  });
  expect(await t.mutation(m("prepare"), args)).toEqual(first);
  for (const name of ["start", "markUnknown", "requestCancel"])
    expect((await t.mutation(m(name), first.operation)).state).toBe("failed");
  await expect(
    t.mutation(m("finishPreparation"), {
      ...first.operation,
      preparation: { ...original, paymentMethodId: "pm_balance" },
      providerApiVersion: "preview",
    }),
  ).rejects.toThrow(/version|failed/i);
  const next = await t.mutation(m("prepare"), { ...args, requestKey: "fresh" });
  expect(next.operation.version).toBe(2);
  const earlier = await t.query(q("inspectOperation"), {
    ...first.operation,
    stripeSubscriptionId: "sub_failure",
  });
  const newer = await t.query(q("inspectOperation"), {
    ...next.operation,
    stripeSubscriptionId: "sub_failure",
  });
  expect(newer.providerKeys.create).not.toBe(earlier.providerKeys.create);
  await expect(
    t.mutation(m("finishPreparation"), {
      ...first.operation,
      preparation: { ...original, paymentMethodId: "pm_balance" },
      providerApiVersion: "preview",
    }),
  ).rejects.toThrow(/version|failed/i);
  expect(
    (
      await t.query(q("getOperation"), {
        ...next.operation,
        stripeSubscriptionId: "sub_failure",
      })
    ).state,
  ).toBe("pending");
});
it("never turns running or unknown provider work into terminal failure or releases its claim", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(m("prepare"), args);
  await t.mutation(m("start"), first.operation);
  await expect(
    t.mutation(m("failBeforeStart"), {
      ...first.operation,
      failureCode: "unsupported_source",
    }),
  ).rejects.toThrow(/started|uncertain/i);
  await t.mutation(m("markUnknown"), first.operation);
  await expect(
    t.mutation(m("failBeforeStart"), {
      ...first.operation,
      failureCode: "unsupported_source",
    }),
  ).rejects.toThrow(/started|uncertain/i);
  expect(
    (
      await t.query(q("getOperation"), {
        ...first.operation,
        stripeSubscriptionId: "sub_failure",
      })
    ).state,
  ).toBe("unknown");
  expect(
    await t.mutation(m("prepare"), { ...args, requestKey: "retry" }),
  ).toEqual(first);
  await expect(
    t.mutation(m("failBeforeStart"), {
      ...first.operation,
      failureCode: "raw provider error with credential",
    }),
  ).rejects.toThrow();
});
