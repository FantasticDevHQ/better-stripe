import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { convex, fillPayment } from "./checkout-test-helpers";
test.use({ video: "on" });
function mutate(name: string, args: object) {
  execFileSync("pnpm", ["exec", "convex", "run", name, JSON.stringify(args)], {
    encoding: "utf8",
    timeout: 60000,
  });
}
async function purchase(
  page: Page,
  info: TestInfo,
  sellerId: string,
  priceId: string,
  label: string,
  expected: {
    amount?: number;
    basisPoints?: number;
    source?: string;
    referred: boolean;
  },
  referral = "avery",
) {
  const before = new Set(
    convex("storeSaleSettlement:listSellerSales", { sellerId }).map(
      (row: { chargeId: string }) => row.chargeId,
    ),
  );
  const url = new URL("/checkout", "http://localhost:5173");
  url.searchParams.set("priceId", priceId);
  url.searchParams.set("checkout", "payment-intent");
  if (referral) url.searchParams.set("ref", referral);
  await page.goto(url.href);
  await fillPayment(page);
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await page.waitForURL(/\/checkout\/status\?/, { timeout: 90000 });
  await expect(
    page.getByText("Payment successful!", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const find = () =>
    convex("storeSaleSettlement:listSellerSales", { sellerId }).find(
      (row: { chargeId: string; stripePriceId?: string }) =>
        !before.has(row.chargeId) && row.stripePriceId === priceId,
    );
  await expect
    .poll(() => find()?.status, { timeout: 60000, intervals: [1000, 3000] })
    .toBe("settled");
  const sale = find();
  const plan = convex("storePlanPricing:list").find(
    (row: { id: string }) => row.id === sale.planId,
  );
  expect(sale.sellingFee).toBe(
    Math.max(
      sale.processingFee,
      Math.round((sale.gross * (plan.feeBasisPoints ?? 0)) / 10000),
    ),
  );
  expect(sale.platformNet).toBe(sale.sellingFee - sale.processingFee);
  const proceeds = sale.gross - sale.sellingFee;
  const affiliate = expected.referred
    ? expected.amount != null
      ? Math.min(proceeds, Math.round(expected.amount * 100))
      : Math.floor((proceeds * (expected.basisPoints ?? 0)) / 10000)
    : 0;
  expect(sale.affiliateNet).toBe(affiliate);
  if (expected.source) expect(sale.affiliateRateSource).toBe(expected.source);
  expect(sale.sellerNet).toBe(
    proceeds - affiliate - (sale.costRecoveryAmount ?? 0),
  );
  expect(sale.sellerNet).toBeGreaterThanOrEqual(0);
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
  const affiliateTransfers = transfers.filter(
    (row: { role: string }) => row.role === "affiliate",
  );
  expect(affiliateTransfers).toHaveLength(affiliate > 0 ? 1 : 0);
  if (affiliate > 0)
    expect(affiliateTransfers[0]).toMatchObject({
      amount: affiliate,
      destinationAccountId: sale.affiliateAccountId,
    });
  const sellerTransfers = transfers.filter(
    (row: { role: string }) => row.role === "store",
  );
  expect(sellerTransfers).toHaveLength(sale.sellerNet > 0 ? 1 : 0);
  if (sale.sellerNet > 0)
    expect(sellerTransfers[0]).toMatchObject({
      amount: sale.sellerNet,
      destinationAccountId: sale.sellerAccountId,
    });
  if (!expected.referred) expect(sale.affiliateAccountId).toBeUndefined();
  const path = info.outputPath(`${label}.json`);
  await writeFile(path, JSON.stringify({ sale, transfers, expected }, null, 2));
  await info.attach(label, { path, contentType: "application/json" });
  await page.screenshot({
    path: info.outputPath(`${label}.png`),
    fullPage: true,
  });
  return sale;
}
test("all store referral links preserve attribution and every commission scope reconciles", async ({
  page,
}, info) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(600000);
  expect(convex("queries:getPublishableKey")).toMatch(/^pk_test_/);
  const stores = convex("storefront:listStores");
  expect(stores.length).toBeGreaterThan(0);
  const users = convex("users:list");
  const admin = users.find((row: { role: string }) => row.role === "admin");
  const globalOriginal = convex("affiliateDefaults:get");
  const store = stores.find(
    (row: { products: { prices: { type: string }[] }[] }) =>
      row.products.some((product) =>
        product.prices.some((price) => price.type === "one_time"),
      ),
  );
  const product = store.products.find((row: { prices: { type: string }[] }) =>
    row.prices.some((price) => price.type === "one_time"),
  );
  const price = product.prices.find(
    (row: { type: string }) => row.type === "one_time",
  );
  const productArgs = {
    sellerId: store.sellerId,
    stripeProductId: product.stripeProductId,
  };
  const priceArgs = { ...productArgs, stripePriceId: price.stripePriceId };
  const productOriginal = convex("sellerAffiliateRates:get", productArgs);
  const priceOriginal = convex("sellerAffiliateRates:get", priceArgs);
  const storeOriginal = convex("affiliateDefaults:get", {
    sellerId: store.sellerId,
  });
  const saveRule = (
    args: object,
    basis: number | null,
    fixed: number | null = null,
  ) => {
    const current = convex("sellerAffiliateRates:get", args);
    mutate("sellerAffiliateRates:save", {
      ...args,
      affiliateBasisPoints: basis,
      affiliateFixedAmount: fixed,
      expectedVersion: current.version,
    });
  };
  await page.addInitScript(() => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "affiliate");
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  try {
    mutate("affiliateDefaults:save", {
      actorId: admin._id,
      affiliateBasisPoints: 1250,
      affiliateFixedAmount: null,
      expectedVersion: globalOriginal.version,
    });
    for (const [index, target] of stores.entries()) {
      const targetPrice = target.products
        .flatMap((row: { prices: { type: string }[] }) => row.prices)
        .find((row: { type: string }) => row.type === "one_time");
      for (const role of ["Visitor", "Customer"] as const) {
        await page.goto("/affiliate/links");
        const affiliateButton = page.getByRole("button", {
          name: "Affiliate",
          exact: true,
        });
        await affiliateButton.click();
        await page.goto("/affiliate/links");
        const link = page.getByRole("link", { name: target.name, exact: true });
        const href = (await link.getAttribute("href"))!;
        const expectedUrl = new URL(href, "http://localhost:5173");
        expect(expectedUrl.searchParams.get("store")).toBe(target.accountId);
        expect(expectedUrl.searchParams.get("ref")).toBe("avery");
        await page
          .getByRole("button", {
            name: `Copy referral link for ${target.name}`,
            exact: true,
          })
          .click();
        expect(
          await page.evaluate(() =>
            (
              navigator as unknown as {
                clipboard: { readText(): Promise<string> };
              }
            ).clipboard.readText(),
          ),
        ).toBe(expectedUrl.href);
        await link.click();
        await page.getByRole("button", { name: role, exact: true }).click();
        await expect(page).toHaveURL(expectedUrl.href);
        await expect(
          page.getByRole("heading", { name: target.name, exact: true }),
        ).toBeVisible();
        for (const other of stores.filter(
          (row: { accountId: string }) => row.accountId !== target.accountId,
        ))
          await expect(
            page.getByRole("heading", { name: other.name, exact: true }),
          ).toHaveCount(0);
        await expect(
          page.getByText(/Referred by Avery Affiliate/),
        ).toBeVisible();
        if (targetPrice) {
          const buy = page.locator(
            `a[href*="priceId=${targetPrice.stripePriceId}"]`,
          );
          await expect(buy).toHaveAttribute("href", /ref=avery/);
          await buy.click();
          await expect(page).toHaveURL(
            new RegExp(`priceId=${targetPrice.stripePriceId}.*ref=avery`),
          );
          if (role === "Customer") {
            const rate = convex("sellerAffiliateRates:get", {
              sellerId: target.sellerId,
              stripeProductId: target.products.find(
                (p: { prices: { stripePriceId: string }[] }) =>
                  p.prices.some(
                    (p) => p.stripePriceId === targetPrice.stripePriceId,
                  ),
              ).stripeProductId,
              stripePriceId: targetPrice.stripePriceId,
            });
            expect(rate.effectiveBasisPoints).toBe(1250);
            await purchase(
              page,
              info,
              target.sellerId,
              targetPrice.stripePriceId,
              `store-${index}-percentage`,
              { basisPoints: 1250, source: "global", referred: true },
              index === 0 ? " AvErY " : "avery",
            );
          }
        }
      }
    }
    await page.getByRole("button", { name: "Visitor", exact: true }).click();
    const storeCurrent = convex("affiliateDefaults:get", {
      sellerId: store.sellerId,
    });
    mutate("affiliateDefaults:save", {
      actorId: store.sellerId,
      sellerId: store.sellerId,
      affiliateBasisPoints: 500,
      affiliateFixedAmount: null,
      expectedVersion: storeCurrent.version,
    });
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "store-wide-percentage",
      { basisPoints: 500, source: "store", referred: true },
    );
    saveRule(productArgs, 1500);
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "product-percentage",
      { basisPoints: 1500, source: "product", referred: true },
    );
    saveRule(priceArgs, 2000);
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "price-percentage",
      { basisPoints: 2000, source: "price", referred: true },
    );
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "invalid-referral",
      { referred: false },
      "invalid-code",
    );
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "no-referral",
      { referred: false },
      "",
    );
    saveRule(priceArgs, 0);
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "explicit-zero",
      { basisPoints: 0, source: "price", referred: true },
    );
    saveRule(priceArgs, null, 10000);
    await purchase(
      page,
      info,
      store.sellerId,
      price.stripePriceId,
      "fixed-payout-cap",
      { amount: 10000, source: "price", referred: true },
    );
  } finally {
    for (const [args, original] of [
      [priceArgs, priceOriginal],
      [productArgs, productOriginal],
    ] as const)
      saveRule(
        args,
        original.affiliateBasisPoints,
        original.affiliateFixedAmount,
      );
    for (const [sellerId, original] of [
      [store.sellerId, storeOriginal],
      [undefined, globalOriginal],
    ] as const) {
      const current = convex("affiliateDefaults:get", { sellerId });
      mutate("affiliateDefaults:save", {
        actorId: sellerId ?? admin._id,
        sellerId,
        affiliateBasisPoints: original.affiliateBasisPoints,
        affiliateFixedAmount: original.affiliateFixedAmount,
        expectedVersion: current.version,
      });
    }
  }
});
