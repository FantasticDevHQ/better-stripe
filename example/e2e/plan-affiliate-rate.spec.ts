import { expect, test } from "@playwright/test";
import { convex, fillPayment } from "./checkout-test-helpers";
test.use({ video: "on" });
test("admin sets a plan affiliate percentage and a sandbox checkout uses it", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(180000);
  const users = convex("users:list");
  const seller = users.find(
    (user: { role: string; storePlan?: { planId: string } }) =>
      user.role === "seller" && user.storePlan?.planId === "growth",
  );
  expect(seller).toBeTruthy();
  const affiliate = users.find(
    (user: { role: string }) => user.role === "affiliate",
  );
  const store = convex("storefront:listStores").find(
    (row: { accountId: string }) => row.accountId === seller.stripeAccountId,
  );
  const price = store.products
    .flatMap(
      (product: { prices: { type: string; stripePriceId: string }[] }) =>
        product.prices,
    )
    .find((row: { type: string }) => row.type === "one_time");
  await page.addInitScript(() => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "admin");
  });
  await page.goto("/admin/store-plans");
  const form = page.getByRole("form", { name: "Growth pricing" });
  const input = form.getByLabel("Affiliate payout (%)");
  await expect(input).toBeVisible();
  const original = await input.inputValue();
  try {
    await input.fill("12.5");
    await form.getByRole("button", { name: "Save pricing" }).click();
    await expect(form.getByRole("status")).toContainText("Pricing saved", {
      timeout: 30000,
    });
    await page.screenshot({
      path: testInfo.outputPath("admin-affiliate-rate.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Seller", exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/store-earnings/);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Billing", exact: true })
      .click();
    await expect(
      page.getByText("Affiliate payout: 12.5% after the sale fee.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Visitor", exact: true }).click();
    await expect(page).toHaveURL(/\/stores/);
    await page.goto(
      `/checkout?priceId=${price.stripePriceId}&ref=avery&checkout=payment-intent`,
    );
    await fillPayment(page);
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    await page.waitForURL(/\/checkout\/status\?payment_intent=pi_/, {
      timeout: 90000,
    });
    await expect(
      page.getByText("Payment successful!", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const paymentIntentId = new URL(page.url()).searchParams.get(
      "payment_intent",
    );
    const find = () =>
      convex("storeSaleSettlement:listSellerSales", {
        sellerId: seller._id,
      }).find(
        (row: { paymentIntentId: string }) =>
          row.paymentIntentId === paymentIntentId,
      );
    await expect
      .poll(() => find()?.status, { timeout: 60000, intervals: [1000, 3000] })
      .toBe("settled");
    const sale = find();
    expect(sale.affiliateBasisPoints).toBe(1250);
    expect(sale.affiliateNet).toBe(
      Math.floor(((sale.gross - sale.sellingFee) * 1250) / 10000),
    );
    expect(sale.gross).toBe(
      sale.processingFee +
        sale.platformNet +
        sale.affiliateNet +
        sale.sellerNet +
        (sale.costRecoveryAmount ?? 0),
    );
    const transfers = convex("queries:listTransfersByCharge", {
      sourceChargeId: sale.chargeId,
    });
    expect(
      transfers.find((row: { role: string }) => row.role === "affiliate"),
    ).toMatchObject({
      destinationAccountId: affiliate.stripeAccountId,
      amount: sale.affiliateNet,
    });
    expect(
      transfers.find((row: { role: string }) => row.role === "store"),
    ).toMatchObject({
      destinationAccountId: seller.stripeAccountId,
      amount: sale.sellerNet,
    });
    await testInfo.attach("settlement-and-stripe-transfers", {
      body: JSON.stringify({ sale, transfers }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath("checkout-success.png"),
      fullPage: true,
    });
  } finally {
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Store plans", exact: true })
      .click();
    await expect(input).toBeVisible();
    await input.fill(original);
    await form.getByRole("button", { name: "Save pricing" }).click();
    await expect(form.getByRole("status")).toContainText("Pricing saved", {
      timeout: 30000,
    });
    await expect(input).toHaveValue(original);
    await page.screenshot({
      path: testInfo.outputPath("restored-affiliate-rate.png"),
      fullPage: true,
    });
  }
});
