// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema";
import { components } from "../../_generated/api";
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components } = await import("../../_generated/api");
  return {
    stripe: { costRecovery: new CostRecoveryClient(components.betterStripe) },
  };
});
it("finishes a mapped partial legacy collection from exact mirrors without executing provider actions", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../src/component/**/*.ts"),
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
    },
    groupKey = "example:cost-settlement:ch_sale";
  for (let i = 0; i < 11; i++) {
    await t.mutation(components.betterStripe.costRecovery.mutations.record, {
      ...scope,
      claimKey: `legacy:${i}`,
      sourceChargeId: `ch_cost_${i}`,
      sourceGross: 1000,
      sourceProcessingFee: 30,
      amountDue: 1,
      revision: 0,
    });
    await t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
      ...scope,
      groupKey,
      sourceKind: "settlement",
      sourceId: "ch_sale",
      sourceGross: 1000,
      sourceProcessingFee: 30,
      maxDebit: 900,
      maxCredit: 100,
      operationKey: `legacy-batch:${i}`,
      limit: 1,
    });
  }
  await t.mutation(components.betterStripe.costRecovery.mutations.seal, {
    groupKey,
  });
  const saleId = await t.run((ctx) =>
    ctx.db.insert("storeSales", {
      sellerId,
      sellerAccountId: "acct_store",
      chargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      planId: "growth",
      gross: 1000,
      processingFee: 30,
      sellingFee: 100,
      platformNet: 70,
      sellerNet: 889,
      affiliateNet: 0,
      currency: "usd",
      costRecoveryAmount: 11,
      recoveryGroupKey: groupKey,
      recoveryReady: true,
      settlementAttempted: true,
      status: "pending",
      sellerTransferId: "tr_known",
    }),
  );
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_known",
    sourceChargeId: "ch_sale",
    destinationAccountId: "acct_store",
    amount: 889,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await t.mutation(components.betterStripe.costRecovery.mutations.finish, {
    groupKey,
    outcome: "collect",
    limit: 1,
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 1, reservedAmount: 10 });
  expect(
    await t.mutation(anyApi.settlement.workflow.mutations.start, { saleId }),
  ).toMatchObject({ status: "completed" });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 11, reservedAmount: 0, outstanding: 0 });
  expect(await t.run((ctx) => ctx.db.get("storeSales", saleId))).toMatchObject({
    status: "settled",
    sellerTransferId: "tr_known",
  });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "settlement", status: "completed" }]);
  await t.mutation(anyApi.settlement.workflow.mutations.start, { saleId });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 11, reservedAmount: 0 });
});
