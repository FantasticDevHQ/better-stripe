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
const preparation = {
  customerAccount: scope.accountId,
  stripeSubscriptionId: "sub_valid",
  paymentMethodId: "pm_balance",
  previousPaymentMethodId: null,
  previousPaymentMethodTypes: null,
};
const initial = {
  ...scope,
  preparation,
  consentAt: 10,
  consentReference: "consent",
  providerApiVersion: "preview",
};
it("rejects malformed restoration without inserting preparation data", async () => {
  const t = convexTest(schema, modules);
  for (const changed of [
    { ...preparation, previousPaymentMethodId: "" },
    { ...preparation, previousPaymentMethodId: preparation.paymentMethodId },
    { ...preparation, previousPaymentMethodTypes: ["stripe_balance"] },
    { ...preparation, previousPaymentMethodTypes: [""] },
    { ...preparation, previousPaymentMethodTypes: Array(51).fill("card") },
  ])
    await expect(
      t.mutation(m("savePreparation"), { ...initial, preparation: changed }),
    ).rejects.toThrow(/invalid/i);
  expect(
    await t.run((ctx) => ctx.db.query("balanceFundingPreparations").take(1)),
  ).toEqual([]);
});
it("validates opaque identities, consent time and imports before any write", async () => {
  const t = convexTest(schema, modules);
  for (const changed of [
    { ...initial, scopeKey: " " },
    { ...initial, consentAt: 1.5 },
    { ...initial, consentReference: "" },
    { ...initial, providerApiVersion: "" },
    { ...initial, preparation: { ...preparation, customerAccount: "foreign" } },
  ])
    await expect(t.mutation(m("savePreparation"), changed)).rejects.toThrow(
      /invalid|identity/i,
    );
  await expect(
    t.mutation(m("importPreparation"), {
      ...initial,
      sourceKey: "legacy",
      enabled: true,
      operationVersion: 0,
      pending: { enabled: false, providerKey: "old", requestKey: "old" },
    }),
  ).rejects.toThrow(/version/i);
  expect(
    await t.run((ctx) => ctx.db.query("balanceFundingPreparations").take(1)),
  ).toEqual([]);
});
it("server-only readers reject foreign scope, subscription and operation version", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), initial);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    stripeSubscriptionId: "sub_valid",
  };
  await expect(
    t.query(q("readPreparation"), { ...args, scopeKey: "foreign" }),
  ).rejects.toThrow(/identity/i);
  await expect(
    t.query(q("readPreparation"), { ...args, stripeSubscriptionId: "foreign" }),
  ).rejects.toThrow(/identity/i);
  const accepted = await t.mutation(m("begin"), {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "on",
  });
  await expect(
    t.query(q("inspectOperation"), {
      ...accepted.operation,
      stripeSubscriptionId: "foreign",
    }),
  ).rejects.toThrow(/identity/i);
  await expect(
    t.query(q("inspectOperation"), {
      ...accepted.operation,
      stripeSubscriptionId: "sub_valid",
      version: 2,
    }),
  ).rejects.toThrow(/identity/i);
});
