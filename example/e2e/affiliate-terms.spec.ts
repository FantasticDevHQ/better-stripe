import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { convex, fillPayment } from "./checkout-test-helpers";
type Price = { stripePriceId: string; type: string };
type Product = { stripeProductId: string; name: string; prices: Price[] };
type Store = { sellerId: string; products: Product[] };
type Sale = { chargeId: string; stripePriceId?: string };
test.use({ video: "on", headless: process.env.E2E_HEADLESS === "1" });
test("subscription checkouts save One-time and Forever commission terms", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(240000);
  expect(convex("stripe/public/queries:getPublishableKey")).toMatch(
    /^pk_test_/,
  );
  const store = convex("storefront/public/queries:listStores").find(
    (s: Store) =>
      s.products.some((p: Product) =>
        p.prices.some((price: Price) => price.type === "recurring"),
      ),
  );
  const product = store.products.find((p: Product) =>
    p.prices.some((price: Price) => price.type === "recurring"),
  );
  const price = product.prices.find(
    (price: Price) => price.type === "recurring",
  );
  const target = {
    sellerId: store.sellerId,
    stripeProductId: product.stripeProductId,
    stripePriceId: price.stripePriceId,
  };
  const original = convex("sellerAffiliateRates/public/queries:get", target);
  await page.addInitScript((sellerId) => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "seller");
    localStorage.setItem("betterstripe-seller", sellerId);
  }, store.sellerId);
  const sales = [];
  try {
    for (const term of ["one_time", "forever"] as const) {
      await page.goto("/seller/products");
      if (
        (await page
          .getByRole("button", { name: "Seller", exact: true })
          .getAttribute("aria-pressed")) !== "true"
      ) {
        await page.getByRole("button", { name: "Seller", exact: true }).click();
        await page.goto("/seller/products");
      }
      const control = page.getByTestId(`affiliate-rate-${price.stripePriceId}`);
      if (!(await control.isVisible()))
        await page.getByText(product.name, { exact: true }).click();
      await control
        .getByRole("spinbutton", { name: "Affiliate payout", exact: true })
        .fill("10");
      await control.getByRole("combobox", { name: "Commission term" }).click();
      await page
        .getByRole("option", {
          name: term === "one_time" ? "One-time" : "Forever",
          exact: true,
        })
        .click();
      await control.getByRole("button", { name: "Save", exact: true }).click();
      await expect(control.getByRole("status")).toHaveText(
        "Affiliate payout saved.",
      );
      await expect(control).toContainText(
        `Commission term: ${term === "one_time" ? "One-time" : "Forever"}`,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${term}-editor.png`),
        fullPage: true,
      });
      const previous = new Set(
        convex("settlement/public/queries:listSellerSales", {
          sellerId: store.sellerId,
        }).map((sale: Sale) => sale.chargeId),
      );
      await page.getByRole("button", { name: "Visitor", exact: true }).click();
      await page.goto(
        `/checkout?priceId=${price.stripePriceId}&ref=avery&checkout=custom`,
      );
      await fillPayment(page);
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await page.waitForURL(/\/checkout\/status\?/, { timeout: 90000 });
      const find = () =>
        convex("settlement/public/queries:listSellerSales", {
          sellerId: store.sellerId,
        }).find(
          (sale: Sale) =>
            !previous.has(sale.chargeId) &&
            sale.stripePriceId === price.stripePriceId,
        );
      await expect
        .poll(() => find()?.status, { timeout: 60000, intervals: [1000, 3000] })
        .toBe("settled");
      const sale = find();
      expect(sale).toMatchObject({
        affiliateCommissionTerm: term,
        affiliateBasisPoints: 1000,
      });
      expect(sale.affiliateNet).toBe(
        Math.floor((sale.gross - sale.sellingFee) * 0.1),
      );
      expect(sale.stripeSubscriptionId).toMatch(/^sub_/);
      sales.push(sale);
    }
    await writeFile(
      testInfo.outputPath("subscription-sales.json"),
      JSON.stringify(sales, null, 2),
    );
  } finally {
    const current = convex("sellerAffiliateRates/public/queries:get", target);
    execFileSync(
      "pnpm",
      [
        "exec",
        "convex",
        "run",
        "sellerAffiliateRates/public/mutations:save",
        JSON.stringify({
          ...target,
          affiliateBasisPoints: original.affiliateBasisPoints,
          affiliateFixedAmount: original.affiliateFixedAmount,
          affiliateCommissionTerm: original.affiliateCommissionTerm ?? null,
          expectedVersion: current.version,
        }),
      ],
      { stdio: "pipe" },
    );
  }
});

test("term controls show readable labels in API, package components and admin", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  const store: Store = convex("storefront/public/queries:listStores")[0];
  await page.addInitScript((sellerId) => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "seller");
    localStorage.setItem("betterstripe-seller", sellerId);
  }, store.sellerId);
  for (const mode of ["headless", "components"]) {
    await page.goto(`/seller/products?example=${mode}`);
    const control = page.getByTestId("store-affiliate-default");
    const select = control.getByRole("combobox", { name: "Commission term" });
    await expect(select).toContainText("Inherited term");
    await select.click();
    await page.getByRole("option", { name: "One-time", exact: true }).click();
    await expect(select).toContainText("One-time");
    await page.screenshot({
      path: testInfo.outputPath(`${mode}-term.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.goto("/admin/store-plans");
  await expect(
    page
      .getByTestId("plan-affiliate-starter")
      .getByRole("combobox", { name: "Commission term" }),
  ).toContainText("Inherited term");
  await page.screenshot({
    path: testInfo.outputPath("admin-term.png"),
    fullPage: true,
  });
});
