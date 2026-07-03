import { expect, test } from "@playwright/test";

/**
 * Affiliate split breakdown demo flow (BTS-43).
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): the demo route boots without
 *    uncaught page errors, both plain and with the `?ref=avery` referral param.
 *    With the placeholder Convex URL the personas/ledger queries stay pending,
 *    so the split panels sit in their loading/empty state — that boundary is by
 *    design; see playwright.config.ts.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo — an
 *    affiliate-referred ($100) purchase → separate store/affiliate transfers
 *    created by the webhook engine → the three-way SplitBreakdown (store /
 *    affiliate / platform) reconciling to the charge. Requires a seeded Convex
 *    dev deployment (VITE_CONVEX_URL) with STRIPE_SECRET_KEY set and webhooks
 *    forwarded (`stripe listen`), so the transfers reach the component. See
 *    example README → "Browser E2E Tests".
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("affiliate-split demo route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Plain, then referral-attributed. Without a backend the RoleProvider holds
  // the app in its loading state; both routes must still boot cleanly.
  await page.goto("/marketplace/split");
  await expect(page.locator("#root")).not.toBeEmpty();

  await page.goto("/marketplace/split?ref=avery");
  await expect(page.locator("#root")).not.toBeEmpty();

  // This page subscribes to the persona/ledger queries on mount, so the Convex
  // client opens its socket to the placeholder deployment URL and surfaces a
  // connection-layer fatal ("[CONVEX FATAL ERROR] Couldn't parse deployment
  // name …") — that is the intended backend-independent boundary (see
  // playwright.config.ts), not an app error. Assert on everything else.
  const appErrors = pageErrors.filter((e) => !/\bCONVEX\b/i.test(e.message));
  expect(
    appErrors,
    `Unexpected page errors:\n${appErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live affiliate split flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + webhook forwarding: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("a referred purchase produces a reconciling three-way split", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Arrive via the affiliate referral; attribution flows from the ?ref param.
    await page.goto("/marketplace/split?ref=avery");
    await expect(page.getByTestId("attribution-badge")).toContainText(
      /Referred by/i,
    );

    // Start the $100 one-time split checkout.
    await page.getByRole("button", { name: "Buy with test card" }).click();

    // Embedded Stripe checkout renders in an iframe; pay with the test card.
    const frame = page.frameLocator('iframe[src*="checkout.stripe.com"]');
    await frame.locator("#email").fill("billie@example.com");
    await frame.locator("#cardNumber").fill("4242424242424242");
    await frame.locator("#cardExpiry").fill("12 / 34");
    await frame.locator("#cardCvc").fill("123");
    await frame.locator("#billingName").fill("Billie Buyer");
    await frame.locator('button[type="submit"]').click();

    await page.waitForURL(/\/checkout\/status\?session_id=cs_/, {
      timeout: 60_000,
    });

    // The webhook engine creates the store + affiliate transfers after the
    // charge; back on the demo, the breakdown resolves to three lines that
    // reconcile to the $100 charge (platform = charge − store − affiliate).
    await page.goto("/marketplace/split?ref=avery");
    const breakdown = page.getByText("Latest sale — split breakdown");
    await expect(breakdown).toBeVisible();
    await expect(page.getByText("Store", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Affiliate", { exact: true })).toBeVisible();
    await expect(page.getByText("Platform", { exact: true })).toBeVisible();
  });
});
