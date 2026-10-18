// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { anyApi, componentsGeneric } from "convex/server";
import { v } from "convex/values";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema";
import { mutation } from "../../../../src/component/_generated/server";
import { components } from "../../_generated/api";
const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components } = await import("../../_generated/api");
  return {
    stripe: {
      costRecovery: Object.assign(
        new CostRecoveryClient(components.betterStripe),
        {
          executeGroupProvider: async (
            ctx: import("../../_generated/server").ActionCtx,
            request: import("@fantastic.dev/better-stripe").RecoveryProviderRequest,
          ) => {
            provider.calls++;
            const operation = await ctx.runQuery(
              components.betterStripe.recoveryWorkflow.queries.snapshot,
              {
                accountId: request.accountId,
                scopeKey: request.scopeKey,
                currency: request.currency,
                groupKey: request.groupKey,
                operationId: request.operationId,
                version: request.version,
              },
            );
            if (!operation.allocation)
              throw new Error("Missing actual original settlement allocation");
            expect(operation.allocation).toMatchObject({
              sourceChargeId: "ch_sale",
              paymentIntentId: "pi_sale",
              gross: 1000,
              processingFee: 30,
              platformNet: 20,
              adjustmentAmount: 0,
              currency: "usd",
            });
            expect(operation.allocation.transfers).toEqual([
              {
                destinationAccountId: "acct_store",
                amount: 900,
                role: "store",
              },
              {
                destinationAccountId: "acct_affiliate",
                amount: 50,
                role: "affiliate",
              },
            ]);
            await ctx.runMutation(
              components.betterStripe.settlement.mutations
                .reserveSettlementAllocation,
              operation.allocation,
            );
            const earning = await ctx.runMutation(
              components.betterStripe.affiliateEarnings.mutations
                .reserveEarning,
              {
                sourceChargeId: "ch_sale",
                affiliateAccountId: "acct_affiliate",
              },
            );
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
            if (earning.releaseAmount > 0)
              await ctx.runMutation(
                components.betterStripe.connect.mutations.upsertTransfer,
                {
                  stripeTransferId: "tr_affiliate",
                  sourceChargeId: "ch_sale",
                  destinationAccountId: "acct_affiliate",
                  amount: earning.releaseAmount,
                  currency: "usd",
                  role: "affiliate",
                  status: "paid",
                },
              );
            await ctx.runMutation(
              components.betterStripe.affiliateEarnings.mutations
                .confirmEarning,
              {
                earningId: earning._id,
                ...(earning.releaseAmount > 0
                  ? { stripeTransferId: "tr_affiliate" }
                  : {}),
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
});
afterEach(() => vi.useRealTimers());
it.each([20, 50])(
  "projects an affiliate payout with %s units offset by the immutable earning ledger",
  async (debt) => {
    const t = convexTest(schema, modules);
    t.registerComponent("betterStripe", componentSchema, {
      ...import.meta.glob("../../../../src/component/**/*.ts"),
      "../../../../src/component/affiliateFixture.ts": async () => ({
        seed: mutation({
          args: { debt: v.number() },
          returns: v.null(),
          handler: async (ctx, args) => {
            await ctx.db.insert("affiliateObligations", {
              sourceChargeId: "ch_old",
              affiliateAccountId: "acct_affiliate",
              currency: "usd",
              chargeAmount: 1000,
              originalCommission: args.debt,
              refundedPrincipal: 1000,
              disputedPrincipal: 0,
              lostPrincipal: 0,
              finalizedAmount: args.debt,
              provisionalAmount: 0,
              recoveredAmount: 0,
              needsReconciliation: false,
              debtAmount: args.debt,
              debtStatus: "open",
            });
            return null;
          },
        }),
      }),
    });
    workflowTest.register(t, "betterStripe/workflow");
    await t.mutation(componentsGeneric().betterStripe.affiliateFixture.seed, {
      debt,
    });
    const sellerId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Seller",
        email: "seller@example.com",
        role: "seller",
        stripeAccountId: "acct_store",
      }),
    );
    const saleId = await t.run((ctx) =>
      ctx.db.insert("storeSales", {
        sellerId,
        sellerAccountId: "acct_store",
        affiliateAccountId: "acct_affiliate",
        chargeId: "ch_sale",
        paymentIntentId: "pi_sale",
        planId: "growth",
        gross: 1000,
        processingFee: 30,
        sellingFee: 100,
        platformNet: 20,
        sellerNet: 900,
        affiliateNet: 50,
        currency: "usd",
        status: "pending",
      }),
    );
    await t.mutation(anyApi.settlement.workflow.mutations.start, { saleId });
    await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
    expect(
      await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
    ).toMatchObject([{ status: "completed" }]);
    expect(
      await t.run((ctx) => ctx.db.get("storeSales", saleId)),
    ).toMatchObject({
      status: "settled",
      affiliateNet: 50,
      ...(debt < 50 ? { affiliateTransferId: "tr_affiliate" } : {}),
    });
    expect(
      await t.query(
        components.betterStripe.affiliateRecovery.queries.getEarning,
        { sourceChargeId: "ch_sale", affiliateAccountId: "acct_affiliate" },
      ),
    ).toMatchObject({
      originalCommission: 50,
      withheldAmount: debt,
      releaseAmount: 50 - debt,
      status: "paid",
    });
    expect(provider.calls).toBe(1);
  },
);
