// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { components, internal } from "./_generated/api";
vi.mock("./stripe", async () => {
  const { CostRecoveryClient } = await import("../../src/client/costRecovery");
  const { components } = await import("./_generated/api");
  return {
    stripe: { costRecovery: new CostRecoveryClient(components.betterStripe) },
  };
});
const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "seller@example.com",
      stripeAccountId: "acct_owner",
    }),
  );
  const costId = await t.run((ctx) =>
    ctx.db.insert("sellerCosts", {
      sellerId,
      sourceChargeId: "ch_original",
      paymentIntentId: "pi_original",
      currency: "usd",
      amountDue: 320,
      collectedAmount: 200,
      invoicedAmount: 0,
      outstanding: 120,
      open: true,
      processingLoss: 320,
      disputeFees: 0,
      observedAt: 100,
    }),
  );
  return {
    t,
    sellerId,
    costId,
    args: {
      costId,
      sourceGross: 10000,
      sourceProcessingFee: 320,
      expectedObservedAt: 100,
    },
  };
}
it("adopts historical collections into the package without making already-paid costs owed again", async () => {
  const { t, sellerId, args } = await setup();
  await t.mutation(internal.recoveryMigration.adoptLegacy, args);
  await t.mutation(internal.recoveryMigration.adoptLegacy, args);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, {
      accountId: "acct_owner",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    }),
  ).toMatchObject({ amountDue: 320, collectedAmount: 200, outstanding: 120 });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_original",
    }),
  ).toMatchObject({
    sourceChargeId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
  });
});
it("refuses an unexplained invoice hold or a changed legacy observation", async () => {
  const { t, args, costId } = await setup();
  await t.run((ctx) =>
    ctx.db.patch("sellerCosts", costId, { invoicedAmount: 50 }),
  );
  await expect(
    t.mutation(internal.recoveryMigration.adoptLegacy, args),
  ).rejects.toThrow(/invoice/i);
  await t.run((ctx) =>
    ctx.db.patch("sellerCosts", costId, { invoicedAmount: 0, observedAt: 101 }),
  );
  await expect(
    t.mutation(internal.recoveryMigration.adoptLegacy, args),
  ).rejects.toThrow(/observation/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_original",
    }),
  ).toBeNull();
});
it("holds migration when a legacy payout with recovery has an unknown outcome", async () => {
  const { t, sellerId, args } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("storeSales", {
      sellerId,
      sellerAccountId: "acct_owner",
      chargeId: "ch_funding",
      paymentIntentId: "pi_funding",
      currency: "usd",
      planId: "growth",
      gross: 10000,
      processingFee: 320,
      sellingFee: 490,
      platformNet: 170,
      sellerNet: 9410,
      affiliateNet: 0,
      costRecoveryAmount: 100,
      status: "pending",
    }),
  );
  await expect(
    t.mutation(internal.recoveryMigration.adoptLegacy, args),
  ).rejects.toThrow(/pending legacy payout/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_original",
    }),
  ).toBeNull();
});
it("replays the opening snapshot after current observations change and refuses seller account reassignment", async () => {
  const { t, sellerId, args, costId } = await setup();
  await t.mutation(internal.recoveryMigration.adoptLegacy, args);
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    accountId: "acct_owner",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
    claimKey: "example:cost:pi_original",
    sourceChargeId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    revision: 1,
    amountDue: 100,
  });
  await t.run((ctx) =>
    ctx.db.patch("sellerCosts", costId, { observedAt: 1, amountDue: 100 }),
  );
  await t.mutation(internal.recoveryMigration.adoptLegacy, args);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, {
      accountId: "acct_owner",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    }),
  ).toMatchObject({ amountDue: 100, collectedAmount: 200, outstanding: -100 });
  await t.run((ctx) =>
    ctx.db.patch("users", sellerId, { stripeAccountId: "acct_other" }),
  );
  await expect(
    t.mutation(internal.recoveryMigration.adoptLegacy, args),
  ).rejects.toThrow(/identity/i);
});
it("quarantines all legacy recovery writers after the first adopted claim", async () => {
  const { t, sellerId, args } = await setup();
  await t.mutation(internal.recoveryMigration.adoptLegacy, args);
  await expect(
    t.mutation(internal.sellerCostBilling.record, {
      sellerId,
      sourceChargeId: "ch_original",
      paymentIntentId: "pi_original",
      currency: "usd",
      amountDue: 0,
      processingLoss: 0,
      disputeFees: 0,
      observedAt: 101,
    }),
  ).rejects.toThrow(/cutover/i);
  await expect(
    t.mutation(internal.sellerCostBilling.claimInvoice, {
      sellerId,
      invoiceId: "in_legacy",
      currency: "usd",
    }),
  ).rejects.toThrow(/cutover/i);
  await expect(
    t.mutation(internal.storeSaleSettlement.reserve, {
      sellerId,
      sellerAccountId: "acct_owner",
      chargeId: "ch_new",
      paymentIntentId: "pi_new",
      currency: "usd",
      planId: "growth",
      gross: 10000,
      processingFee: 320,
      sellingFee: 490,
      platformNet: 170,
      sellerNet: 9510,
      affiliateNet: 0,
    }),
  ).rejects.toThrow(/cutover/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, {
      accountId: "acct_owner",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    }),
  ).toMatchObject({ amountDue: 320, collectedAmount: 200, outstanding: 120 });
});
it("keeps seller history chronological across currencies alongside the migration lookup", async () => {
  const { t, sellerId } = await setup();
  vi.useFakeTimers();
  try {
    const base = {
      sellerId,
      sellerAccountId: "acct_owner",
      planId: "growth" as const,
      gross: 10000,
      processingFee: 320,
      sellingFee: 490,
      platformNet: 170,
      sellerNet: 9510,
      affiliateNet: 0,
      status: "settled" as const,
    };
    for (const [index, currency] of ["usd", "eur", "usd"].entries()) {
      vi.setSystemTime(1800000000000 + index * 1000);
      await t.run((ctx) =>
        ctx.db.insert("storeSales", {
          ...base,
          chargeId: `ch_${index}`,
          paymentIntentId: `pi_${index}`,
          currency,
        }),
      );
    }
    const { api } = await import("./_generated/api");
    const rows = await t.query(api.storeSaleSettlement.listSellerSales, {
      sellerId,
    });
    expect(rows.map((row) => row.chargeId)).toEqual(["ch_2", "ch_1", "ch_0"]);
  } finally {
    vi.useRealTimers();
  }
});
