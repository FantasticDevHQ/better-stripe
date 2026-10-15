// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");
async function fixture() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  await t.mutation(components.betterStripe.core.mutations.upsertAccount, {
    userId,
    stripeAccountId: "acct_store",
    appliedConfigurations: ["recipient"],
    onboardingStatus: "complete",
  });
  return { t, userId };
}

it("returns only the original charge identity and currency for the store owner", async () => {
  const { t, userId } = await fixture();
  await t.mutation(
    components.betterStripe.settlement.mutations.reserveSettlementAllocation,
    {
      sourceChargeId: "ch_isk",
      paymentIntentId: "pi_original",
      gross: 50000,
      currency: "isk",
      processingFee: 0,
      platformNet: 0,
      transfers: [
        { destinationAccountId: "acct_store", role: "store", amount: 50000 },
      ],
    },
  );
  expect(
    await t.query(api.queries.getRefundChargeContext, {
      userId,
      sourceChargeId: " ch_isk ",
    }),
  ).toEqual({ sourceChargeId: "ch_isk", currency: "isk" });
});

it.each(["foreign", "affiliate", "other"] as const)(
  "does not disclose charge currency to a %s recipient",
  async (role) => {
    const { t, userId } = await fixture();
    await t.mutation(
      components.betterStripe.settlement.mutations.reserveSettlementAllocation,
      {
        sourceChargeId: "ch_foreign",
        gross: 50000,
        currency: "jpy",
        processingFee: 0,
        platformNet: 0,
        transfers:
          role === "foreign"
            ? [
                {
                  destinationAccountId: "acct_another",
                  role: "store",
                  amount: 50000,
                },
              ]
            : [
                {
                  destinationAccountId: "acct_another",
                  role: "store",
                  amount: 40000,
                },
                { destinationAccountId: "acct_store", role, amount: 10000 },
              ],
      },
    );
    expect(
      await t.query(api.queries.getRefundChargeContext, {
        userId,
        sourceChargeId: "ch_foreign",
      }),
    ).toBeNull();
  },
);

it("returns null for absent charges, blank identifiers and missing personas/accounts", async () => {
  const { t, userId } = await fixture();
  await t.mutation(
    components.betterStripe.settlement.mutations.reserveSettlementAllocation,
    {
      sourceChargeId: "ch_owned",
      gross: 500,
      currency: "jpy",
      processingFee: 0,
      platformNet: 0,
      transfers: [
        { destinationAccountId: "acct_store", role: "store", amount: 500 },
      ],
    },
  );
  for (const args of [
    { userId, sourceChargeId: "ch_absent" },
    { userId, sourceChargeId: " " },
    { userId: "missing_persona", sourceChargeId: "ch_owned" },
  ])
    expect(await t.query(api.queries.getRefundChargeContext, args)).toBeNull();
  await t.run((ctx) =>
    ctx.db.patch("users", userId, { stripeAccountId: "acct_missing" }),
  );
  expect(
    await t.query(api.queries.getRefundChargeContext, {
      userId,
      sourceChargeId: "ch_owned",
    }),
  ).toBeNull();
});

it("rejects a stale persona link when the component account belongs to another user", async () => {
  const { t, userId } = await fixture();
  await t.mutation(components.betterStripe.core.mutations.upsertAccount, {
    userId: "another_user",
    stripeAccountId: "acct_store",
    appliedConfigurations: ["recipient"],
    onboardingStatus: "complete",
  });
  await t.mutation(
    components.betterStripe.settlement.mutations.reserveSettlementAllocation,
    {
      sourceChargeId: "ch_stale",
      gross: 500,
      currency: "jpy",
      processingFee: 0,
      platformNet: 0,
      transfers: [
        { destinationAccountId: "acct_store", role: "store", amount: 500 },
      ],
    },
  );
  expect(
    await t.query(api.queries.getRefundChargeContext, {
      userId,
      sourceChargeId: "ch_stale",
    }),
  ).toBeNull();
});
