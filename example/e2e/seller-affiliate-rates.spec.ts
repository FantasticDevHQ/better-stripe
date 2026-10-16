import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { convex, fillPayment } from "./checkout-test-helpers";
test.use({ video: "on" });
type Price = { stripePriceId: string; type: string };
type Product = { name: string; stripeProductId: string; prices: Price[] };
async function openProduct(page: Page, product: Product) {
  const control = page.getByTestId(
    `affiliate-rate-${product.prices[0].stripePriceId}`,
  );
  if (!(await control.isVisible()))
    await page.getByText(product.name, { exact: true }).click();
}
test("seller product and subscription overrides control real sandbox splits and can inherit again", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(240000);
  expect(convex("stripe/public/queries:getPublishableKey")).toMatch(
    /^pk_test_/,
  );
  const store = convex("storefront/public/queries:listStores").find(
    (row: { products: Product[] }) =>
      row.products.some((p) => p.prices.some((v) => v.type === "one_time")) &&
      row.products.some((p) => p.prices.some((v) => v.type === "recurring")),
  );
  expect(store).toBeTruthy();
  const product: Product = store.products.find((p: Product) =>
    p.prices.some((v) => v.type === "one_time"),
  );
  const recurring: Product = store.products.find((p: Product) =>
    p.prices.some((v) => v.type === "recurring"),
  );
  const one = product.prices.find((p) => p.type === "one_time")!;
  const month = recurring.prices.find((p) => p.type === "recurring")!;
  const targets = [
    { product, id: product.stripeProductId, value: "15", fixed: false },
    { product, id: one.stripePriceId, value: "12.5", fixed: true },
    { product: recurring, id: month.stripePriceId, value: "10", fixed: true },
  ];
  const originals: {
    product: Product;
    id: string;
    value: string;
    fixed: boolean;
  }[] = [];
  await page.addInitScript((sellerId) => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "seller");
    if (!localStorage.getItem("betterstripe-seller"))
      localStorage.setItem("betterstripe-seller", sellerId);
  }, store.sellerId);
  await page.goto("/seller/products");
  try {
    for (const target of targets) {
      await openProduct(page, target.product);
      const control = page.getByTestId(`affiliate-rate-${target.id}`);
      const input = control.getByRole("spinbutton", {
        name: "Affiliate payout",
        exact: true,
      });
      originals.push({
        ...target,
        value: await input.inputValue(),
        fixed:
          (await control
            .getByRole("button", { name: "Fixed amount in USD" })
            .getAttribute("aria-pressed")) === "true",
      });
      await control
        .getByRole("button", {
          name: target.fixed ? "Fixed amount in USD" : "Percentage",
          exact: true,
        })
        .click();
      await input.fill(target.value);
      await control.getByRole("button", { name: "Save", exact: true }).click();
      await expect(control.getByRole("status")).toHaveText(
        "Affiliate payout saved.",
      );
      await expect(control).toContainText(
        `Effective payout: ${target.fixed ? `$${Number(target.value).toFixed(2)}` : `${target.value}%`}`,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${target.id}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Visitor", exact: true }).click();
    await expect(page).toHaveURL(/\/stores/);
    for (const [price, basisPoints, mode] of [
      [one, 12.5, "payment-intent"],
      [month, 10, "custom"],
    ] as const) {
      const previous = new Set(
        convex("settlement/public/queries:listSellerSales", {
          sellerId: store.sellerId,
        }).map((sale: { chargeId: string }) => sale.chargeId),
      );
      await page.goto(
        `/checkout?priceId=${price.stripePriceId}&ref=avery&checkout=${mode}`,
      );
      await fillPayment(page);
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await page.waitForURL(/\/checkout\/status\?/, { timeout: 90000 });
      await expect(
        page.getByText("Payment successful!", { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      const find = () =>
        convex("settlement/public/queries:listSellerSales", {
          sellerId: store.sellerId,
        }).find(
          (sale: { chargeId: string; stripePriceId?: string }) =>
            !previous.has(sale.chargeId) &&
            sale.stripePriceId === price.stripePriceId,
        );
      await expect
        .poll(() => find()?.status, { timeout: 60000, intervals: [1000, 3000] })
        .toBe("settled");
      const sale = find();
      expect(sale).toMatchObject({
        affiliateFixedAmount: basisPoints,
        affiliateRateSource: "price",
        stripePriceId: price.stripePriceId,
      });
      expect(sale.affiliateNet).toBe(
        Math.min(sale.gross - sale.sellingFee, basisPoints * 100),
      );
      expect(sale.gross).toBe(
        sale.processingFee +
          sale.platformNet +
          sale.affiliateNet +
          sale.sellerNet +
          (sale.costRecoveryAmount ?? 0),
      );
      if (price.type === "recurring")
        expect(sale.sourceInvoiceId).toMatch(/^in_/);
      const transfers = convex("connect/queries:listTransfersByCharge", {
        sourceChargeId: sale.chargeId,
      });
      expect(
        transfers.find((row: { role: string }) => row.role === "affiliate")
          .amount,
      ).toBe(sale.affiliateNet);
      const artifact = testInfo.outputPath(`${price.type}-settlement.json`);
      await writeFile(artifact, JSON.stringify({ sale, transfers }, null, 2));
      await testInfo.attach(`${price.type}-settlement`, {
        path: artifact,
        contentType: "application/json",
      });
      await page.screenshot({
        path: testInfo.outputPath(`${price.type}-success.png`),
        fullPage: true,
      });
    }
  } finally {
    if (
      await page
        .getByRole("button", { name: "Seller", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "Seller", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Products", exact: true })
      .click();
    for (const original of originals.reverse()) {
      await openProduct(page, original.product);
      const control = page.getByTestId(`affiliate-rate-${original.id}`);
      await control
        .getByRole("button", {
          name: original.fixed ? "Fixed amount in USD" : "Percentage",
          exact: true,
        })
        .click();
      await control
        .getByRole("spinbutton", { name: "Affiliate payout", exact: true })
        .fill(original.value);
      await control.getByRole("button", { name: "Save", exact: true }).click();
      await expect(control.getByRole("status")).toHaveText(
        "Affiliate payout saved.",
      );
    }
  }
});
test("inline clear saves inheritance in seller and admin controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  const store = convex("storefront/public/queries:listStores").find(
    (row: { products: Product[] }) => row.products.length,
  );
  const product: Product = store.products[0];
  const original = convex("sellerAffiliateRates/public/queries:get", {
    sellerId: store.sellerId,
    stripeProductId: product.stripeProductId,
  });
  const plan = convex("storePlans/pricing/public/queries:list")[1];
  await page.addInitScript((sellerId) => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "seller");
    if (!localStorage.getItem("betterstripe-seller"))
      localStorage.setItem("betterstripe-seller", sellerId);
  }, store.sellerId);
  await page.goto("/seller/products");
  const control = page.getByTestId(`affiliate-rate-${product.stripeProductId}`);
  await control.getByRole("button", { name: "Fixed amount in USD" }).click();
  await control.getByRole("spinbutton").fill("5.25");
  await control.getByRole("button", { name: "Save", exact: true }).click();
  await expect(control.getByRole("status")).toHaveText(
    "Affiliate payout saved.",
  );
  await control.getByRole("button", { name: "Clear affiliate payout" }).click();
  await expect(control.getByRole("status")).toContainText("cleared");
  expect(
    convex("sellerAffiliateRates/public/queries:get", {
      sellerId: store.sellerId,
      stripeProductId: product.stripeProductId,
    }),
  ).toMatchObject({ affiliateBasisPoints: null, affiliateFixedAmount: null });
  await page.screenshot({
    path: testInfo.outputPath("seller-cleared.png"),
    fullPage: true,
  });
  if (
    original.affiliateBasisPoints != null ||
    original.affiliateFixedAmount != null
  ) {
    await control
      .getByRole("button", {
        name:
          original.affiliateFixedAmount != null
            ? "Fixed amount in USD"
            : "Percentage",
        exact: true,
      })
      .click();
    await control
      .getByRole("spinbutton")
      .fill(
        String(
          original.affiliateFixedAmount ?? original.affiliateBasisPoints / 100,
        ),
      );
    await control.getByRole("button", { name: "Save", exact: true }).click();
    await expect(control.getByRole("status")).toHaveText(
      "Affiliate payout saved.",
    );
  }
  const priceId = product.prices[0].stripePriceId;
  const priceArgs = {
    sellerId: store.sellerId,
    stripeProductId: product.stripeProductId,
    stripePriceId: priceId,
  };
  const priceOriginal = convex(
    "sellerAffiliateRates/public/queries:get",
    priceArgs,
  );
  await page.goto("/seller/products?example=components");
  const priceControl = page.getByTestId(`affiliate-rate-${priceId}`);
  await priceControl
    .getByRole("button", { name: "Percentage", exact: true })
    .click();
  await priceControl.getByRole("spinbutton").fill("0");
  await priceControl.getByRole("button", { name: "Save", exact: true }).click();
  await expect(priceControl.getByRole("status")).toContainText("saved");
  expect(
    convex("sellerAffiliateRates/public/queries:get", priceArgs)
      .effectiveBasisPoints,
  ).toBe(0);
  await priceControl
    .getByRole("button", { name: "Clear affiliate payout" })
    .click();
  await expect(priceControl.getByRole("status")).toContainText("cleared");
  if (
    priceOriginal.affiliateFixedAmount != null ||
    priceOriginal.affiliateBasisPoints != null
  ) {
    await priceControl
      .getByRole("button", {
        name:
          priceOriginal.affiliateFixedAmount != null
            ? "Fixed amount in USD"
            : "Percentage",
        exact: true,
      })
      .click();
    await priceControl
      .getByRole("spinbutton")
      .fill(
        String(
          priceOriginal.affiliateFixedAmount ??
            priceOriginal.affiliateBasisPoints / 100,
        ),
      );
    await priceControl
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(priceControl.getByRole("status")).toContainText("saved");
  }
  await page.screenshot({
    path: testInfo.outputPath("components-inline.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Store plans", exact: true })
    .click();
  const admin = page.getByTestId("plan-affiliate-growth");
  await admin.getByRole("button", { name: "Fixed amount in USD" }).click();
  await admin.getByRole("spinbutton").fill("8.25");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("saved");
  await admin.getByRole("button", { name: "Clear affiliate payout" }).click();
  await expect(admin.getByRole("status")).toContainText("cleared");
  expect(convex("storePlans/pricing/public/queries:list")[1]).toMatchObject({
    affiliateFixedAmount: null,
    affiliateBasisPoints: null,
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-cleared.png"),
    fullPage: true,
  });
  await admin
    .getByRole("button", {
      name:
        plan.affiliateFixedAmount != null
          ? "Fixed amount in USD"
          : "Percentage",
      exact: true,
    })
    .click();
  await admin
    .getByRole("spinbutton")
    .fill(
      plan.affiliateFixedAmount == null && plan.affiliateBasisPoints == null
        ? ""
        : String(plan.affiliateFixedAmount ?? plan.affiliateBasisPoints / 100),
    );
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("saved");
});
