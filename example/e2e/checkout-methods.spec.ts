import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
test.use({
  headless: process.env.E2E_HEADLESS === "1",
  video: "on",
  screenshot: "only-on-failure",
});
const live = !!process.env.E2E_LIVE_BACKEND;
function convex(name: string, args = {}) {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "convex", "run", name, JSON.stringify(args)],
      { encoding: "utf8", timeout: 60000 },
    ),
  );
}
async function fillPayment(page: Page) {
  const deadline = Date.now() + 45000;
  let filledOnce = false;
  while (Date.now() < deadline) {
    let foundCard = false;
    for (const frame of page.frames()) {
      const choose = frame.getByRole("button", {
        name: "Pay with card",
        exact: true,
      });
      if (
        (await choose.count().catch(() => 0)) &&
        !(await frame
          .locator("#cardNumber")
          .count()
          .catch(() => 0))
      )
        await choose.dispatchEvent("click").catch((error) => {
          if (!frame.isDetached()) throw error;
        });
      const card = frame.getByRole("button", { name: "Card", exact: true });
      if (await card.isVisible().catch(() => false)) await card.click();
      const country = frame
        .getByRole("combobox", { name: /^Country(?: or region)?$/i })
        .first();
      if (await country.isVisible().catch(() => false))
        await country.selectOption({ label: "United States" });
      for (const [selector, value] of [
        [
          '#checkout-email, #payment-email, #email, input[name="email"]',
          "checkout-example@example.com",
        ],
        ['#cardNumber, input[name="number"]', "4242424242424242"],
        ['#cardExpiry, input[name="expiry"]', "1234"],
        ['#cardCvc, input[name="cvc"]', "123"],
        ['#billingName, input[name="name"]', "Sandbox Test Buyer"],
        [
          '#billingPostalCode, input[name="postalCode"], input[autocomplete="postal-code"]',
          "10001",
        ],
      ]) {
        const input = frame.locator(selector).first();
        if (await input.isVisible().catch(() => false)) {
          if (await input.isEditable()) await input.fill(value);
          if (selector.includes("cardNumber")) foundCard = true;
        }
      }
    }
    if (foundCard && filledOnce) return;
    filledOnce = foundCard;
    await page.waitForTimeout(500);
  }
  throw new Error("No Stripe card input became available");
}
for (const [mode, role] of [
  ["embedded", "visitor"],
  ["custom", "visitor"],
  ["payment-intent", "visitor"],
  ["form", "visitor"],
  ["redirect", "visitor"],
  ["payment-intent", "customer"],
] as const) {
  test(`${mode} completes a referred ${role === "visitor" ? "guest" : "customer"} purchase in Stripe sandbox`, async ({
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
    await page.goto(`/checkout?priceId=${price}&ref=avery&checkout=${mode}`);
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
    expect(settlement.affiliateNet).toBeGreaterThan(0);
    expect(settlement.sellerTransferId).toMatch(/^tr_/);
    expect(settlement.affiliateTransferId).toMatch(/^tr_/);
    expect(settlement.gross).toBe(
      settlement.processingFee +
        settlement.platformNet +
        settlement.affiliateNet +
        settlement.sellerNet +
        (settlement.costRecoveryAmount ?? 0),
    );
  });
}
