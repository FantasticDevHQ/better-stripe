import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Refunds & reversals seller ops page (BTS-80).
 *
 * Always-run layer: boot `/seller/refunds` without uncaught app errors and
 * capture the available shell to `/tmp/bts-example/refunds/`. With the
 * placeholder Convex URL the RoleProvider can remain in its loading state; that
 * is the same backend-independent boundary used by the other seller specs.
 *
 * Live layer: when `E2E_LIVE_BACKEND=1` points at a seeded Convex + Stripe test
 * deployment, assert the refund/reversal controls and figures render.
 */

test.use({ video: "on" });

const LIVE = !!process.env.E2E_LIVE_BACKEND;
const SCREENSHOT_DIR = "/tmp/bts-example/refunds";
const SET_SELLER_ROLE = `window.localStorage.setItem("betterlearn-role", "seller")`;

test("refunds and reversals route boots without uncaught page errors", async ({
  page,
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.addInitScript(SET_SELLER_ROLE);
  await page.goto("/seller/refunds");
  await expect(page.locator("#root")).not.toBeEmpty();
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/refunds-reversals-shell.png`,
    fullPage: true,
  });

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live refunds and reversals UI", () => {
  test.skip(
    !LIVE,
    "Requires seeded Convex + Stripe test deployment: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=…",
  );

  test("seller can see refund and reversal controls", async ({ page }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.addInitScript(SET_SELLER_ROLE);

    await page.goto("/seller/refunds");
    await expect(page.getByTestId("refunds-page")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("refund-payment-intent-input")).toBeVisible();
    await expect(page.getByTestId("refund-full-button")).toBeVisible();
    await expect(page.getByTestId("refund-partial-button")).toBeVisible();
    await expect(page.getByTestId("refund-history-count")).toBeVisible();
    await expect(page.getByTestId("reversal-charge-input")).toBeVisible();
    await expect(page.getByTestId("reversal-full-button")).toBeVisible();
    await expect(page.getByTestId("reversal-partial-button")).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/refunds-reversals-live.png`,
      fullPage: true,
    });
  });
});

test("seller issues a partial refund then refunds the remaining balance", async ({
  page,
}) => {
  test.skip(
    !LIVE || process.env.E2E_REFUND_SANDBOX !== "1",
    "Requires disposable sandbox payments",
  );
  test.setTimeout(120000);
  function query(name: string, args = {}) {
    return JSON.parse(
      execFileSync(
        "pnpm",
        ["exec", "convex", "run", name, JSON.stringify(args)],
        { encoding: "utf8", timeout: 60000 },
      ),
    );
  }
  expect(query("stripe/public/queries:getStripeMode")).toBe("test");
  const seller = query("users/queries:list").find(
    (user: { email: string }) => user.email === "maya@example.com",
  );
  const sales = query("settlement/public/queries:listSellerSales", {
    sellerId: seller._id,
  });
  const sale = sales.find(
    (sale: { status: string; paymentIntentId: string }) =>
      sale.status === "settled" &&
      !query("connect/queries:getPaymentByStripeId", {
        stripePaymentIntentId: sale.paymentIntentId,
      }).refundedAmount,
  );
  expect(sale).toBeTruthy();
  await page.addInitScript((sellerId) => {
    localStorage.setItem("betterlearn-role", "seller");
    localStorage.setItem("betterstripe-seller", sellerId);
  }, seller._id);
  await page.goto(`/seller/refunds?payment_intent=${sale.paymentIntentId}`);
  await page.getByTestId("refund-partial-amount-input").fill("1.00");
  await page.getByTestId("refund-partial-button").click();
  await expect(page.getByTestId("refund-result")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("refund-payment-refunded")).toContainText(
    "$1.00",
    { timeout: 30000 },
  );
  await page.getByTestId("refund-full-button").click();
  await expect(page.getByTestId("refund-payment-refund-status")).toContainText(
    "full",
    { timeout: 30000 },
  );
  await expect(page.getByTestId("refund-history-count")).toHaveText("2");
  await expect(page.getByTestId("refunds-error")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("partial-and-full-refund.png"),
    fullPage: true,
  });
});
