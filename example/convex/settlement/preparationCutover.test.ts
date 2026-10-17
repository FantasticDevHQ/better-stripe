// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import componentSchema from "../../../src/component/schema";
import { components, internal } from "../_generated/api";
vi.mock("../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../src/client/costRecovery");
  const { components } = await import("../_generated/api");
  return {
    stripe: { costRecovery: new CostRecoveryClient(components.betterStripe) },
  };
});
it("continues an empty historical reservation using the component preparation sequence", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../src/component/**/*.ts"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  const scope = {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
  };
  const group = {
    ...scope,
    groupKey: "example:cost-settlement:ch_sale",
    sourceKind: "settlement" as const,
    sourceId: "ch_sale",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    maxDebit: 9510,
    maxCredit: 490,
  };
  await t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
    ...group,
    operationKey: `${group.groupKey}:batch:0`,
  });
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    ...scope,
    claimKey: "cost:other",
    sourceChargeId: "ch_other",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 30,
    revision: 0,
  });
  const sale = await t.mutation(
    internal.settlement.internal.mutations.reserve,
    {
      chargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      sellerId,
      sellerAccountId: "acct_store",
      planId: "growth",
      gross: 10000,
      processingFee: 320,
      sellingFee: 490,
      platformNet: 170,
      sellerNet: 9510,
      affiliateNet: 0,
      currency: "usd",
    },
  );
  expect(sale).toMatchObject({
    recoveryReady: true,
    costRecoveryAmount: 30,
    sellerNet: 9480,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.group, {
      groupKey: group.groupKey,
    }),
  ).toMatchObject({ status: "sealed", amount: 30, preparationSequence: 1 });
});
it("prepares a legacy empty invoice group without recycling its old batch identity", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../src/component/**/*.ts"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  const scope = {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
  };
  const group = {
    ...scope,
    groupKey: "example:cost-invoice:in_cost",
    sourceKind: "invoice" as const,
    sourceId: "in_cost",
    maxDebit: Number.MAX_SAFE_INTEGER,
    maxCredit: Number.MAX_SAFE_INTEGER,
  };
  await t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
    ...group,
    operationKey: `${group.groupKey}:batch:0`,
  });
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    ...scope,
    claimKey: "cost:other",
    sourceChargeId: "ch_other",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 30,
    revision: 0,
  });
  expect(
    await t.mutation(internal.sellerCosts.recoveryInvoices.mutations.prepare, {
      sellerId,
      invoiceId: "in_cost",
      currency: "usd",
    }),
  ).toBe(true);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.group, {
      groupKey: group.groupKey,
    }),
  ).toMatchObject({ status: "sealed", amount: 30, preparationSequence: 1 });
});
