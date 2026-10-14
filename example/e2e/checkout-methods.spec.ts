import { convex, fillPayment } from "./checkout-test-helpers";
import { expect, test } from "@playwright/test";
test.use({
  headless: process.env.E2E_HEADLESS === "1",
  video: "on",
  screenshot: "only-on-failure",
});
const live = !!process.env.E2E_LIVE_BACKEND;
for (const [mode, role, referralCode] of [
  ["embedded", "visitor", "avery"],
  ["custom", "visitor", "avery"],
  ["payment-intent", "visitor", "avery"],
  ["form", "visitor", "avery"],
  ["redirect", "visitor", "avery"],
  ["payment-intent", "customer", "avery"],
  ["custom", "customer", "avery"],
  ["custom", "customer", "invalid-code"],
] as const) {
  test(`${mode} completes a ${referralCode === "avery" ? "referred" : "direct"} ${role === "visitor" ? "guest" : "customer"} purchase in Stripe sandbox`, async ({
    page,
  }) => {
    test.skip(!live, "Requires seeded Stripe sandbox");
    test.setTimeout(180000);
    const stores = convex("storefront:listStores");
    const price = stores
      .flatMap(
        (store: {
          products: {
            prices: { stripePriceId: string; type: string; active: boolean }[];
          }[];
        }) => store.products.flatMap((product) => product.prices),
      )
      .find(
        (price: { type: string; active: boolean }) => price.type === "one_time",
      ).stripePriceId;
    await page.addInitScript(
      (role) => localStorage.setItem("betterlearn-role", role),
      role,
    );
    await page.goto(
      `/checkout?priceId=${price}&ref=${referralCode}&checkout=${mode}`,
    );
    if (mode === "redirect")
      await page
        .getByRole("button", { name: "Continue to Stripe Checkout" })
        .click();
    await fillPayment(page);
    if (["custom", "payment-intent"].includes(mode))
      await page.getByRole("button", { name: "Pay", exact: true }).click();
    else {
      let clicked = false;
      for (const frame of page.frames()) {
        const pay = frame
          .getByRole("button", { name: /^(Pay|Subscribe)(\s+\$[\d.,]+)?$/ })
          .first();
        if (await pay.isVisible().catch(() => false)) {
          await expect(pay).toBeEnabled();
          await pay.click();
          clicked = true;
          break;
        }
      }
      expect(clicked).toBe(true);
    }
    await page.waitForURL(
      /\/checkout\/status\?(session_id=cs_|payment_intent=pi_)/,
      { timeout: 90000 },
    );
    await expect(
      page.getByText("Payment successful!", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const url = new URL(page.url());
    let chargeId: string;
    if (url.searchParams.has("session_id")) {
      const sale = convex("e2eCheckout:inspectSale", {
        stripeSessionId: url.searchParams.get("session_id"),
      });
      expect(sale.paymentStatus).toBe("paid");
      chargeId = sale.chargeId;
    } else {
      const payment = convex("queries:getPaymentByStripeId", {
        stripePaymentIntentId: url.searchParams.get("payment_intent"),
      });
      expect(payment.status).toBe("succeeded");
      if (role === "customer") expect(payment.userId).not.toBe("");
      const findSale = () =>
        convex("storeSaleSettlement:listSellerSales", {
          sellerId: payment.metadata.sellerId,
        }).find(
          (sale: { paymentIntentId: string }) =>
            sale.paymentIntentId === payment.stripePaymentIntentId,
        );
      await expect
        .poll(() => findSale()?.chargeId, { timeout: 60000 })
        .toMatch(/^ch_/);
      chargeId = findSale().chargeId;
    }
    expect(chargeId).toMatch(/^ch_/);
    await expect
      .poll(
        () => convex("storeSaleSettlement:getByCharge", { chargeId })?.status,
        { timeout: 60000, intervals: [1000, 3000] },
      )
      .toBe("settled");
    const settlement = convex("storeSaleSettlement:getByCharge", { chargeId });
    const plan = convex("storePlanPricing:list", {}).find(
      (row: { id: string }) => row.id === settlement.planId,
    );
    const expectedFee = Math.max(
      settlement.processingFee,
      Math.round((settlement.gross * (plan.feeBasisPoints ?? 0)) / 10000),
    );
    expect(settlement.affiliateBasisPoints).toBe(plan.affiliateBasisPoints);
    expect(settlement.sellingFee).toBe(expectedFee);
    expect(settlement.platformNet).toBe(expectedFee - settlement.processingFee);
    expect(settlement.affiliateNet).toBe(
      referralCode === "avery"
        ? Math.floor(
            ((settlement.gross - expectedFee) * plan.affiliateBasisPoints) /
              10000,
          )
        : 0,
    );
    expect(settlement.sellerNet).toBe(
      settlement.gross -
        expectedFee -
        settlement.affiliateNet -
        (settlement.costRecoveryAmount ?? 0),
    );
    expect(settlement.sellerTransferId).toMatch(/^tr_/);
    if (referralCode === "avery")
      expect(settlement.affiliateTransferId).toMatch(/^tr_/);
    else expect(settlement.affiliateTransferId).toBeUndefined();
    await test.info().attach("settlement", {
      body: JSON.stringify(settlement, null, 2),
      contentType: "application/json",
    });
    expect(settlement.gross).toBe(
      settlement.processingFee +
        settlement.platformNet +
        settlement.affiliateNet +
        settlement.sellerNet +
        (settlement.costRecoveryAmount ?? 0),
    );
  });
}
