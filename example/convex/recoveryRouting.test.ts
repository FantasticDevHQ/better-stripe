// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { internal, components } from "./_generated/api";
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
  const scope = {
    accountId: "acct_owner",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
  };
  const sale = {
    sellerId,
    sellerAccountId: "acct_owner",
    chargeId: "ch_new",
    paymentIntentId: "pi_new",
    planId: "growth" as const,
    gross: 10000,
    processingFee: 320,
    sellingFee: 490,
    platformNet: 170,
    sellerNet: 9510,
    affiliateNet: 0,
    currency: "usd",
  };
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    ...scope,
    claimKey: "old-cost",
    sourceChargeId: "ch_old",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    amountDue: 320,
    revision: 1,
  });
  return { t, sellerId, scope, sale };
}
it("reserves recovery before transfer without treating the reservation as collected", async () => {
  const { t, scope, sale } = await setup();
  const saved = await t.mutation(internal.storeSaleSettlement.reserve, sale);
  expect(saved).toMatchObject({
    sellerNet: 9190,
    costRecoveryAmount: 320,
    recoveryReady: true,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 0, reservedAmount: 320, outstanding: 0 });
  await t.mutation(internal.storeSaleSettlement.reserve, sale);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 0, reservedAmount: 320 });
});
it("allows new seller earnings while an unpaid invoice holds recovery, without collecting it again", async () => {
  const { t, scope, sale } = await setup();
  await t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
    ...scope,
    groupKey: "invoice-held",
    operationKey: "invoice-held:1",
    sourceKind: "invoice",
    sourceId: "in_unpaid",
    maxDebit: 320,
    maxCredit: 0,
  });
  await t.mutation(components.betterStripe.costRecovery.mutations.seal, {
    groupKey: "invoice-held",
  });
  const saved = await t.mutation(internal.storeSaleSettlement.reserve, sale);
  expect(saved).toMatchObject({
    sellerNet: 9510,
    costRecoveryAmount: 0,
    recoveryReady: true,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({
    activeGroupKey: "invoice-held",
    reservedAmount: 320,
    collectedAmount: 0,
  });
});
it("stores source observations in package claims and rejects stale revisions", async () => {
  const { t, sellerId, scope } = await setup();
  const args = {
    sellerId,
    sourceChargeId: "ch_observed",
    paymentIntentId: "pi_observed",
    currency: "usd",
    amountDue: 320,
    processingLoss: 320,
    disputeFees: 0,
    observedAt: 1,
    sourceGross: 10000,
    sourceProcessingFee: 320,
    expectedRevision: -1,
  };
  await t.mutation(internal.sellerCostBilling.record, args);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: "example:cost:pi_observed",
    }),
  ).toMatchObject({ amountDue: 320, revision: 0, sourceGross: 10000 });
  await expect(
    t.mutation(internal.sellerCostBilling.record, {
      ...args,
      amountDue: 0,
      observedAt: 2,
    }),
  ).rejects.toThrow(/observation changed/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ amountDue: 640 });
});
it("keeps reservations held when a transfer may already be in flight", async () => {
  const { t, scope, sale } = await setup();
  const saved = await t.mutation(internal.storeSaleSettlement.reserve, sale);
  await t.mutation(internal.storeSaleSettlement.beginAttempt, {
    saleId: saved._id,
  });
  await t.mutation(internal.storeSaleSettlement.markUnpaidSaleRefunded, {
    chargeId: sale.chargeId,
  });
  expect(
    await t.query(internal.storeSaleSettlement.getByCharge, {
      chargeId: sale.chargeId,
    }),
  ).toMatchObject({ status: "pending", settlementAttempted: true });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ reservedAmount: 320, collectedAmount: 0 });
  await expect(
    t.mutation(internal.storeSaleSettlement.collectRecovery, {
      saleId: saved._id,
    }),
  ).rejects.toThrow(/transfers/);
});
it("prepares invoice recovery in bounded package reservations and keeps unpaid amounts uncollected", async () => {
  const { t, sellerId, scope } = await setup();
  expect(
    await t.mutation(internal.recoveryInvoices.prepare, {
      sellerId,
      invoiceId: "in_next",
      currency: "usd",
    }),
  ).toBe(true);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ reservedAmount: 320, collectedAmount: 0 });
  expect(
    await t.mutation(internal.recoveryInvoices.prepare, {
      sellerId,
      invoiceId: "in_next",
      currency: "usd",
    }),
  ).toBe(true);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.group, {
      groupKey: "example:cost-invoice:in_next",
    }),
  ).toMatchObject({ amount: 320, status: "sealed" });
});
it("releases a canceled allocation only before any provider attempt has started", async () => {
  const { t, scope, sale } = await setup();
  await t.mutation(internal.storeSaleSettlement.reserve, sale);
  await t.mutation(internal.storeSaleSettlement.markUnpaidSaleRefunded, {
    chargeId: sale.chargeId,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ reservedAmount: 0, collectedAmount: 0, outstanding: 320 });
});
it("prepares multiple reservation batches and commits once with rollback tied to original funding economics", async () => {
  const { t, scope, sale } = await setup();
  for (let i = 0; i < 105; i++)
    await t.mutation(components.betterStripe.costRecovery.mutations.record, {
      ...scope,
      claimKey: `batch:${i}`,
      sourceChargeId: `ch_batch_${i}`,
      sourceGross: 1000,
      sourceProcessingFee: 59,
      amountDue: 1,
      revision: 0,
    });
  let saved = await t.mutation(internal.storeSaleSettlement.reserve, sale);
  expect(saved.recoveryReady).toBe(false);
  while (!saved.recoveryReady)
    saved = await t.mutation(internal.storeSaleSettlement.prepareRecovery, {
      saleId: saved._id,
    });
  expect(saved.costRecoveryAmount).toBe(425);
  await t.mutation(internal.storeSaleSettlement.beginAttempt, {
    saleId: saved._id,
  });
  await t.mutation(internal.storeSaleSettlement.recordTransfer, {
    saleId: saved._id,
    role: "store",
    transferId: "tr_confirmed",
  });
  expect(
    await t.mutation(internal.storeSaleSettlement.collectRecovery, {
      saleId: saved._id,
    }),
  ).toBe(true);
  await t.mutation(internal.storeSaleSettlement.collectRecovery, {
    saleId: saved._id,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 425, reservedAmount: 0, outstanding: 0 });
  await t.mutation(components.betterStripe.costRecovery.mutations.rollback, {
    groupKey: saved.recoveryGroupKey!,
    returnedPrincipal: 5000,
    revision: 0,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.claim, {
      claimKey: `rollback:${saved.recoveryGroupKey}`,
    }),
  ).toMatchObject({
    sourceChargeId: "ch_new",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    amountDue: 213,
  });
});
it("defers a second invoice's recovery while another boundary is unresolved, so the plan can still bill", async () => {
  const { t, sellerId, scope } = await setup();
  await t.mutation(internal.recoveryInvoices.prepare, {
    sellerId,
    invoiceId: "in_held",
    currency: "usd",
  });
  expect(
    await t.mutation(internal.recoveryInvoices.prepare, {
      sellerId,
      invoiceId: "in_later",
      currency: "usd",
    }),
  ).toBeNull();
  expect(
    await t.query(components.betterStripe.costRecovery.queries.group, {
      groupKey: "example:cost-invoice:in_later",
    }),
  ).toBeNull();
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({
    reservedAmount: 320,
    collectedAmount: 0,
    activeGroupKey: "example:cost-invoice:in_held",
  });
});
