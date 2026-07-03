import { expect, test } from "@playwright/test";

/**
 * Destination charge + platform fee demo flow, single recipient (BTS-58).
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): the demo route
 *    (`/demo/destination-charge`) boots without uncaught page errors, both
 *    plain and with a `session_id` query param (the post-checkout return
 *    shape). With the placeholder Convex URL the marketplace-context query
 *    stays pending, so the page sits in its loading state — that boundary is
 *    by design; see playwright.config.ts.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo — buyer
 *    (Billie) buys Sasha's Ceramics Masterclass ($129 one-time) via embedded
 *    Stripe checkout as a destination charge, then the page confirms the
 *    charge and shows the fee/payout breakdown reconciling exactly to the
 *    charge amount. Requires a seeded Convex dev deployment (VITE_CONVEX_URL)
 *    with STRIPE_SECRET_KEY set and webhooks forwarded (`stripe listen`), so
 *    the checkout session's `complete` status reaches the component. See
 *    README → "Browser E2E Tests".
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("destination-charge demo route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Plain, then the post-checkout return shape (a placeholder session id —
  // the real flow always carries a real `cs_…` id, substituted by Stripe).
  await page.goto("/demo/destination-charge");
  await expect(page.locator("#root")).not.toBeEmpty();

  await page.goto("/demo/destination-charge?session_id=cs_e2e_placeholder");
  await expect(page.locator("#root")).not.toBeEmpty();

  // This page subscribes to the marketplace-context query on mount, so the
  // Convex client opens its socket to the placeholder deployment URL and
  // surfaces a connection-layer fatal ("[CONVEX FATAL ERROR] Couldn't parse
  // deployment name …") — that is the intended backend-independent boundary
  // (see playwright.config.ts), not an app error. Assert on everything else.
  const appErrors = pageErrors.filter((e) => !/\bCONVEX\b/i.test(e.message));
  expect(
    appErrors,
    `Unexpected page errors:\n${appErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live destination-charge flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + webhook forwarding: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("buyer buys the seeded one-time price and the fee/payout breakdown reconciles", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/demo/destination-charge");
    await expect(
      page.getByRole("heading", { name: /destination charge/i }),
    ).toBeVisible();

    // Embedded Stripe checkout renders in an iframe; pay with the standard
    // test card. Selectors follow Stripe's embedded checkout form.
    const frame = page.frameLocator('iframe[src*="checkout.stripe.com"]');
    await frame.locator("#email").fill("billie@example.com");
    await frame.locator("#cardNumber").fill("4242424242424242");
    await frame.locator("#cardExpiry").fill("12 / 34");
    await frame.locator("#cardCvc").fill("123");
    await frame.locator("#billingName").fill("Billie Buyer");
    await frame.locator('button[type="submit"]').click();

    // Stripe substitutes {CHECKOUT_SESSION_ID} into the return URL, which
    // points back at this same page (BTS-58 confirms inline, unlike the
    // generic /checkout/status redirect BTS-57/62 uses).
    await page.waitForURL(/\/demo\/destination-charge\?session_id=cs_/, {
      timeout: 60_000,
    });

    await expect(
      page.getByTestId("charge-complete-badge"),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/reconciles exactly to the charge amount/i),
    ).toBeVisible();
  });
});
