import { expect, test } from "@playwright/test";

/**
 * Paid subscription + payout/balance visibility demo flow (BTS-42).
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): the buyer subscribe route
 *    (`/demo/subscribe`) and the seller earnings route (`/demo/store-earnings`)
 *    boot without uncaught page errors. With the placeholder Convex URL the
 *    marketplace-context query stays pending, so both pages sit in their
 *    loading state — that boundary is by design; see playwright.config.ts.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo — buyer
 *    (Billie, from the BTS-41 marketplace seed) subscribes to Maya's Fitness
 *    Studio monthly plan via embedded Stripe checkout in subscription mode
 *    (a destination charge, no trial → a real charge), then lands on the store
 *    earnings page where the platform fee, balance, and payouts are visible.
 *    Requires a seeded Convex dev deployment (VITE_CONVEX_URL) with
 *    STRIPE_SECRET_KEY set, linked persona accounts, and webhooks forwarded
 *    (`stripe listen`) so the charge/invoice/payout events reach the component.
 *    See README → "Browser E2E Tests".
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("subscribe and store-earnings routes boot without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/demo/subscribe");
  await expect(page.locator("#root")).not.toBeEmpty();

  await page.goto("/demo/store-earnings");
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live paid subscription + payout visibility flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + webhook forwarding: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("buyer subscribes to a store plan and the seller sees fee + balance/payouts", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Buyer subscribe page: the marketplace seed's store (Maya's Fitness Studio)
    // and its monthly plan resolve from getMarketplaceDemoContext.
    await page.goto("/demo/subscribe");
    await expect(
      page.getByRole("heading", { name: /Subscribe to/ }),
    ).toBeVisible({ timeout: 30_000 });

    // Embedded Stripe checkout renders in an iframe; pay with the standard test
    // card. Subscription mode with no trial charges the first invoice now.
    const frame = page.frameLocator('iframe[src*="checkout.stripe.com"]');
    await frame.locator("#email").fill("billie@example.com");
    await frame.locator("#cardNumber").fill("4242424242424242");
    await frame.locator("#cardExpiry").fill("12 / 34");
    await frame.locator("#cardCvc").fill("123");
    await frame.locator("#billingName").fill("Billie Buyer");
    await frame.locator('button[type="submit"]').click();

    // onComplete routes the buyer to the store earnings view.
    await page.waitForURL(/\/demo\/store-earnings/, { timeout: 90_000 });

    // Seller view: the store earnings header and the merged surfaces render.
    await expect(
      page.getByRole("heading", { name: /Earnings/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Balance & payouts")).toBeVisible();

    // The platform fee on the resulting invoice becomes visible once the
    // invoice.paid webhook syncs the charge (a 10% application fee).
    await expect(page.getByText(/Platform fee \(10%\)/)).toBeVisible({
      timeout: 90_000,
    });
  });
});
