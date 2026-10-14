import { expect, test, type Page } from "@playwright/test";
import { convex, fillPayment } from "./checkout-test-helpers";

// Stripe's documented sandbox cards. No payment requests are mocked.
test.use({ headless: false, video: "on", screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(180000);
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "visitor"),
  );
});
async function openCheckout(page: Page, mode: string) {
  const stores = convex("storefront:listStores");
  const store = stores.find(
    (s: { name: string }) => s.name === "Sasha's Ceramics",
  );
  const price = store.products
    .flatMap(
      (p: { prices: { type: string; stripePriceId: string }[] }) => p.prices,
    )
    .find((p: { type: string }) => p.type === "one_time");
  await page.goto(
    `/checkout?priceId=${price.stripePriceId}&checkout=${mode}&ref=avery`,
  );
  if (mode === "redirect")
    await page
      .getByRole("button", { name: "Continue to Stripe Checkout" })
      .click();
}
async function submit(page: Page, mode: string) {
  if (["custom", "payment-intent"].includes(mode)) {
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    return;
  }
  for (const frame of page.frames()) {
    const button = frame
      .getByRole("button", { name: /^(Pay|Subscribe)(\s+\$[\d.,]+)?$/ })
      .first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }
  throw new Error("No checkout submit button was available");
}
async function expectError(page: Page, message: RegExp) {
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (
            await frame
              .getByText(message)
              .first()
              .isVisible()
              .catch(() => false)
          )
            return true;
        }
        return false;
      },
      { timeout: 45000 },
    )
    .toBe(true);
  expect(page.url()).not.toContain("/checkout/status");
  await page.screenshot({
    path: test.info().outputPath("payment-error.png"),
    fullPage: true,
  });
}
async function expectPaidAndSplit(page: Page, mode: string) {
  await page.waitForURL(
    /\/checkout\/status\?(session_id=cs_|payment_intent=pi_)/,
    { timeout: 90000 },
  );
  await expect(
    page.getByText("Payment successful!", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const params = new URL(page.url()).searchParams;
  let chargeId: string;
  if (params.has("session_id"))
    chargeId = convex("e2eCheckout:inspectSale", {
      stripeSessionId: params.get("session_id"),
    }).chargeId;
  else {
    const payment = convex("queries:getPaymentByStripeId", {
      stripePaymentIntentId: params.get("payment_intent"),
    });
    const findSale = () =>
      convex("storeSaleSettlement:listSellerSales", {
        sellerId: payment.metadata.sellerId,
      }).find(
        (s: { paymentIntentId: string }) =>
          s.paymentIntentId === params.get("payment_intent"),
      );
    await expect
      .poll(() => findSale()?.chargeId, { timeout: 60000 })
      .toMatch(/^ch_/);
    chargeId = findSale().chargeId;
  }
  await expect
    .poll(
      () => convex("storeSaleSettlement:getByCharge", { chargeId })?.status,
      { timeout: 60000 },
    )
    .toBe("settled");
  const sale = convex("storeSaleSettlement:getByCharge", { chargeId });
  expect(sale.affiliateNet).toBe(
    Math.floor(
      ((sale.gross - sale.sellingFee) * sale.affiliateBasisPoints) / 10000,
    ),
  );
  expect(sale.gross).toBe(
    sale.processingFee +
      sale.platformNet +
      sale.affiliateNet +
      sale.sellerNet +
      (sale.costRecoveryAmount ?? 0),
  );
  await test.info().attach("settlement", {
    body: JSON.stringify({ mode, sale }, null, 2),
    contentType: "application/json",
  });
}
for (const [mode, card, message] of [
  ["embedded", "4000000000000002", /card.*declined/i],
  ["custom", "4000000000009995", /insufficient funds/i],
  ["payment-intent", "4000000000009995", /insufficient funds/i],
  ["payment-intent", "4000000000000069", /expired/i],
  ["payment-intent", "4000000000000127", /security code.*incorrect/i],
  ["form", "4000000000000002", /card.*declined/i],
  ["redirect", "4000000000000002", /card.*declined/i],
] as const) {
  test(`${mode} rejects card ${card.slice(-4)} and preserves attribution on a good-card retry`, async ({
    page,
  }) => {
    await openCheckout(page, mode);
    await test.step("It should reject the documented bad card without completing checkout", async () => {
      await fillPayment(page, card);
      await submit(page, mode);
      await expectError(page, message);
    });
    await test.step("It should accept a good card on the same checkout and pay the affiliate once", async () => {
      await fillPayment(
        page,
        mode === "custom" ? "5555555555554444" : "4242424242424242",
      );
      await submit(page, mode);
      await expectPaidAndSplit(page, mode);
    });
  });
}
for (const [mode, outcome] of [
  ["custom", "complete"],
  ["payment-intent", "cancel"],
  ["payment-intent", "decline"],
] as const) {
  test(`${mode} handles 3D Secure ${outcome}`, async ({ page }) => {
    page.on("dialog", async (dialog) => {
      expect(["confirm", "beforeunload"]).toContain(dialog.type());
      console.log("Stripe sandbox confirmation:", dialog.message());
      await dialog.accept();
    });
    await openCheckout(page, mode);
    await fillPayment(
      page,
      outcome === "complete"
        ? "4000008400000027"
        : outcome === "decline"
          ? "4000008400001629"
          : "4000000000003220",
    );
    await submit(page, mode);
    await test.step(`It should show the Stripe authentication challenge and ${outcome}`, async () => {
      await expect
        .poll(
          async () => {
            for (const frame of page.frames()) {
              const button = frame.getByRole("button", {
                name:
                  outcome === "cancel"
                    ? /^cancel$/i
                    : /^(Complete|Complete authentication)$/i,
              });
              if (await button.isVisible().catch(() => false)) {
                if (mode === "custom") await button.click();
                else await button.press("Enter");
                return true;
              }
            }
            return false;
          },
          { timeout: 45000 },
        )
        .toBe(true);
    });
    if (outcome !== "complete") {
      // Match the app error, never explanatory text inside the challenge.
      await expect(page.getByRole("alert")).toContainText(
        outcome === "decline" ? /declin/i : /cancel|authenticat|declin/i,
        { timeout: 45000 },
      );
      await expect(
        page.getByRole("button", { name: "Pay", exact: true }),
      ).toBeEnabled();
      expect(page.url()).not.toContain("/checkout/status");
      await page.screenshot({
        path: test.info().outputPath("authentication-error.png"),
        fullPage: true,
      });
      await fillPayment(page);
      await submit(page, mode);
    }
    await expectPaidAndSplit(page, mode);
  });
}
