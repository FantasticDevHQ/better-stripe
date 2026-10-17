// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema";
import { components, internal } from "../../_generated/api";
const provider = vi.hoisted(() => ({
  calls: 0,
  writeMirror: true,
  owner: "",
  legacyCalls: 0,
}));
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components } = await import("../../_generated/api");
  return {
    stripe: {
      getVerifiedSale: async () => ({
        status: "ready",
        chargeId: "ch_sale",
        paymentIntentId: "pi_sale",
        gross: 1000,
        processingFee: 30,
        currency: "usd",
        metadata: {
          storeBilling: "sale_v1",
          sellerId: provider.owner,
          planId: "growth",
          userId: "buyer_original",
        },
      }),
      settleSale: async () => {
        provider.legacyCalls++;
        return {
          executedTransfers: [{ stripeTransferId: "tr_store", role: "store" }],
        };
      },
      costRecovery: Object.assign(
        new CostRecoveryClient(components.betterStripe),
        {
          executeGroupProvider: async (
            ctx: import("../../_generated/server").ActionCtx,
            request: import("@fantastic.dev/better-stripe").RecoveryProviderRequest,
          ) => {
            provider.calls++;
            if (provider.writeMirror)
              await ctx.runMutation(
                components.betterStripe.connect.mutations.upsertTransfer,
                {
                  stripeTransferId: "tr_store",
                  sourceChargeId: "ch_sale",
                  destinationAccountId: "acct_store",
                  amount: 900,
                  currency: "usd",
                  role: "store",
                  status: "paid",
                },
              );
            return {
              ...request,
              sourceId: "ch_sale",
              status: "ready",
              outcome: "collect",
            };
          },
        },
      ),
    },
  };
});
beforeEach(() => {
  vi.useFakeTimers();
  provider.calls = 0;
  provider.legacyCalls = 0;
  provider.writeMirror = true;
});
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../src/component/**/*.ts"),
  );
  workflowTest.register(t, "betterStripe/workflow");
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  provider.owner = sellerId;
  const sale = await t.mutation(
    internal.settlement.internal.mutations.reserve,
    {
      chargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      sellerId,
      sellerAccountId: "acct_store",
      planId: "growth",
      gross: 1000,
      processingFee: 30,
      sellingFee: 100,
      platformNet: 70,
      sellerNet: 900,
      affiliateNet: 0,
      currency: "usd",
    },
  );
  return { t, sellerId, sale };
}
it("starts one durable workflow and projects verified transfer mirrors on completion", async () => {
  const { t, sellerId, sale } = await fixture();
  const op = await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  expect(
    (
      await t.mutation(anyApi.settlement.workflow.mutations.start, {
        saleId: sale._id,
      })
    ).operationId,
  ).toBe(op.operationId);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "pending" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.calls).toBe(1);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({
    status: "settled",
    sellerTransferId: "tr_store",
    settlementAttempted: true,
  });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "settlement", status: "completed" }]);
});
it("does not settle a legacy collected group from missing or mismatched mirrors", async () => {
  const { t, sale } = await fixture();
  await t.mutation(components.betterStripe.costRecovery.mutations.finish, {
    groupKey: sale.recoveryGroupKey!,
    outcome: "collect",
  });
  await expect(
    t.mutation(anyApi.settlement.workflow.mutations.start, {
      saleId: sale._id,
    }),
  ).rejects.toThrow(/transfer.*mirror/i);
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_foreign_amount",
    sourceChargeId: "ch_sale",
    destinationAccountId: "acct_store",
    amount: 899,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await expect(
    t.mutation(anyApi.settlement.workflow.mutations.start, {
      saleId: sale._id,
    }),
  ).rejects.toThrow(/transfer.*mirror/i);
  expect(provider.calls).toBe(0);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "pending" });
});
it("repairs the projection of a collected legacy group using exact mirrors without provider replay", async () => {
  const { t, sale, sellerId } = await fixture();
  await t.mutation(components.betterStripe.costRecovery.mutations.finish, {
    groupKey: sale.recoveryGroupKey!,
    outcome: "collect",
  });
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_known",
    sourceChargeId: "ch_sale",
    destinationAccountId: "acct_store",
    amount: 900,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  expect(provider.calls).toBe(0);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "settlement", status: "completed" }]);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "settled", sellerTransferId: "tr_known" });
});

it("keeps an unknown legacy in-flight boundary held and observable", async () => {
  const { t, sellerId, sale } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch("storeSales", sale._id, { settlementAttempted: true }),
  );
  expect(
    await t.mutation(anyApi.settlement.workflow.mutations.start, {
      saleId: sale._id,
    }),
  ).toMatchObject({ status: "unknown", reason: "history_incomplete" });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([
    {
      kind: "settlement",
      status: "blocked",
      reason: "legacy_inflight_unknown",
    },
  ]);
  expect(
    (
      await t.query(components.betterStripe.costRecovery.queries.group, {
        groupKey: sale.recoveryGroupKey!,
      })
    )?.status,
  ).toBe("sealed");
  expect(provider.calls).toBe(0);
});

it("routes the settlement action to the workflow before any provider execution", async () => {
  const { t, sale } = await fixture();
  await t.action(anyApi.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(provider.legacyCalls).toBe(0);
  expect(provider.calls).toBe(0);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "pending" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.calls).toBe(1);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "settled" });
  expect(
    await t.query(
      components.betterStripe.connect.queries.getPaymentByStripeId,
      { stripePaymentIntentId: "pi_sale" },
    ),
  ).toMatchObject({
    userId: "buyer_original",
    metadata: { costRecoveryAmount: "0" },
  });
});
it("holds the owning reservation when a sale cancels before provider dispatch", async () => {
  const { t, sale, sellerId } = await fixture();
  await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  await t.mutation(
    internal.settlement.internal.mutations.markUnpaidSaleRefunded,
    { chargeId: sale.chargeId },
  );
  expect(
    (
      await t.query(components.betterStripe.costRecovery.queries.group, {
        groupKey: sale.recoveryGroupKey!,
      })
    )?.status,
  ).toBe("sealed");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.calls).toBe(0);
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "settlement", status: "canceled" }]);
  expect(
    (
      await t.query(components.betterStripe.costRecovery.queries.group, {
        groupKey: sale.recoveryGroupKey!,
      })
    )?.status,
  ).toBe("sealed");
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "refunded" });
});
it("resumes a failed projection from its saved receipt without executing the provider again", async () => {
  const { t, sale } = await fixture();
  provider.writeMirror = false;
  await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.calls).toBe(1);
  expect(
    (
      await t.query(components.betterStripe.costRecovery.queries.group, {
        groupKey: sale.recoveryGroupKey!,
      })
    )?.status,
  ).toBe("collected");
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "pending" });
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_store",
    sourceChargeId: "ch_sale",
    destinationAccountId: "acct_store",
    amount: 900,
    currency: "usd",
    role: "store",
    status: "paid",
  });
  await t.mutation(anyApi.settlement.workflow.mutations.start, {
    saleId: sale._id,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.calls).toBe(1);
  expect(
    await t.run((ctx) => ctx.db.get("storeSales", sale._id)),
  ).toMatchObject({ status: "settled", sellerTransferId: "tr_store" });
});
