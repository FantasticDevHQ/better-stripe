import { storeSalePolicyContext } from "./workflow/helpers";
// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { setup, storeSaleRaw } from "../../testing/settlement/storeSaleFixture";
import { runAction } from "../../testing/settlement/providerFixture";
import { stripe } from "../stripe/helpers";
import { components, internal } from "../_generated/api";
import { costScope } from "../sellerCosts/recovery";
const raw = storeSaleRaw();

it("rejects a competing saved split with the same recipients but different original amounts", async () => {
  const { t, sellerId, payment } = await setup("starter", true);
  const scope = costScope(sellerId, "acct_store", "usd");
  // A genuine different invoice owns this scope's recovery. The new sale uses the supported fallback.
  await t.run(async (ctx) => {
    await stripe.costRecovery.recordClaim(ctx, {
      ...scope,
      claimKey: "other-invoice-cost",
      sourceChargeId: "ch_other",
      sourceGross: 1000,
      sourceProcessingFee: 30,
      amountDue: 30,
      revision: 1,
    });
    const prepared = await stripe.costRecovery.prepareGroup(ctx, {
      ...scope,
      groupKey: "other-invoice-group",
      sourceKind: "invoice",
      sourceId: "in_other",
      maxDebit: 1000,
      maxCredit: 0,
    });
    expect(prepared.status).toBe("prepared");
  });
  let reads = 0;
  raw.paymentIntents.retrieve.mockImplementation(async () => {
    if (++reads === 2) {
      const sale = await t.query(
        internal.settlement.internal.queries.getByCharge,
        { chargeId: "ch_sale" },
      );
      if (!sale) throw new Error("Original sale was not reserved");
      await t.mutation(
        components.betterStripe.settlement.mutations
          .reserveSettlementAllocation,
        {
          policyContext: storeSalePolicyContext(sale),
          sourceChargeId: "ch_sale",
          paymentIntentId: "pi_sale",
          gross: 10000,
          currency: "usd",
          processingFee: 320,
          platformNet: 580,
          transfers: [
            { destinationAccountId: "acct_store", role: "store", amount: 7000 },
            {
              destinationAccountId: "acct_affiliate",
              role: "affiliate",
              amount: 2100,
            },
          ],
        },
      );
    }
    return structuredClone(payment);
  });
  await expect(
    runAction(t, internal.settlement.internal.actions.settle, {
      paymentIntentId: "pi_sale",
    }),
  ).rejects.toThrow("Settlement authorization changed");
  expect(raw.transfers.create).not.toHaveBeenCalled();
});

it("allows only the real component earning's reduced release while retaining original commission economics", async () => {
  const { t } = await setup("starter", true, 320, 100);
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(raw.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ destination: "acct_affiliate", amount: 1720 }),
    expect.anything(),
  );
  expect(
    await t.query(
      components.betterStripe.affiliateRecovery.queries.getEarning,
      { sourceChargeId: "ch_sale", affiliateAccountId: "acct_affiliate" },
    ),
  ).toMatchObject({
    originalCommission: 1820,
    withheldAmount: 100,
    releaseAmount: 1720,
    status: "paid",
  });
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toMatchObject({ sellerNet: 7280, affiliateNet: 1820, status: "settled" });
});

it("retains the first positive-cash sale policy in the actual public component allocation", async () => {
  const { t } = await setup("starter", true, 320, 100);
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  const sale = await t.query(internal.settlement.internal.queries.getByCharge, {
    chargeId: "ch_sale",
  });
  expect(sale).not.toBeNull();
  expect(
    await t.query(
      components.betterStripe.settlement.queries.getSettlementAllocation,
      { sourceChargeId: "ch_sale" },
    ),
  ).toMatchObject({
    policyContext: {
      namespace: "better-stripe.vite.store-sale",
      version: 1,
      fields: {
        saleId: sale?._id,
        planId: sale?.planId,
        platformNet: String(sale?.platformNet),
      },
    },
  });
});
