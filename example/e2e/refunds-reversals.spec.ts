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
