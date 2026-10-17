// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { expect, it, vi, beforeEach } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import componentSchema from "../../../../src/component/schema";
import { components, internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { settle } from "../internal/actions";
const provider = vi.hoisted(() => ({ owner: "", calls: 0, fenced: false }));
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components, internal } = await import("../../_generated/api");
  return {
    stripe: {
      costRecovery: new CostRecoveryClient(components.betterStripe),
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
        },
      }),
      settleSale: async (ctx: ActionCtx) => {
        provider.calls++;
        await ctx.runMutation(
          internal.settlement.internal.mutations.markUnpaidSaleRefunded,
          { chargeId: "ch_sale" },
        );
        const sale = await ctx.runQuery(
          internal.settlement.internal.queries.getByCharge,
          { chargeId: "ch_sale" },
        );
        provider.fenced =
          sale?.settlementAttempted === true && sale.status === "pending";
        return {
          executedTransfers: [{ role: "store", stripeTransferId: "tr_store" }],
        };
      },
    },
  };
});
function isStart(ref: Parameters<ActionCtx["runMutation"]>[0]) {
  try {
    return getFunctionName(ref) === "settlement/workflow/mutations:start";
  } catch {
    return false;
  }
}
beforeEach(() => {
  provider.calls = 0;
  provider.fenced = false;
});
async function fixture() {
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
  provider.owner = sellerId;
  await t.mutation(components.betterStripe.costRecovery.mutations.record, {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
    claimKey: "old",
    sourceChargeId: "ch_old",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 1,
    revision: 0,
  });
  await t.mutation(components.betterStripe.costRecovery.preparation.prepare, {
    accountId: "acct_store",
    scopeKey: `example:store:${sellerId}`,
    currency: "usd",
    groupKey: "other-invoice",
    sourceKind: "invoice",
    sourceId: "in_other",
    maxDebit: 100,
    maxCredit: 0,
  });
  return t;
}
it("fences a no-owned-recovery payout before an in-flight refund can mark it unpaid", async () => {
  const t = await fixture();
  await t.action(internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(provider.calls).toBe(1);
  expect(provider.fenced).toBe(true);
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toMatchObject({ status: "settled", settlementAttempted: true });
});
it("rejects a refund arriving after the direct branch decision but before dispatch", async () => {
  const t = await fixture();
  await expect(
    t.action(async (ctx) => {
      const wrapped = new Proxy(ctx, {
        get(target, key) {
          if (key !== "runMutation") return Reflect.get(target, key);
          return async (
            ref: Parameters<ActionCtx["runMutation"]>[0],
            args: Record<string, unknown>,
          ) => {
            const result = await target.runMutation(ref, args);
            if (isStart(ref))
              await target.runMutation(
                internal.settlement.internal.mutations.markUnpaidSaleRefunded,
                { chargeId: "ch_sale" },
              );
            return result;
          };
        },
      });
      return (
        settle as unknown as {
          _handler: (
            ctx: ActionCtx,
            args: { paymentIntentId: string },
          ) => Promise<null>;
        }
      )._handler(wrapped, { paymentIntentId: "pi_sale" });
    }),
  ).rejects.toThrow(/not payable/i);
  expect(provider.calls).toBe(0);
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toMatchObject({ status: "refunded" });
});
