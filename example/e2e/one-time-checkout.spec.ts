import { expect, test } from "@playwright/test";

/**
 * One-time payment checkout demo flow (BTS-57).
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): the payment-mode checkout
 *    entry point (`/checkout?priceId=…` for a one-time price) boots without
 *    uncaught page errors, as does the success route. With the placeholder
 *    Convex URL the app sits in its loading state — that boundary is by
 *    design; see playwright.config.ts.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo — landing →
 *    one-time price card ("Ceramics Masterclass" from the marketplace seed,
 *    BTS-41) → embedded Stripe checkout in payment mode → test card → Stripe
 *    redirects to /checkout/status?session_id=cs_… → success page. Requires a
 *    seeded Convex dev deployment (VITE_CONVEX_URL) with STRIPE_SECRET_KEY set
 *    and webhooks forwarded (`stripe listen`), so the session's `complete`
 *    status reaches the component. See README → "Browser E2E Tests".
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("payment-mode checkout route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // A one-time price's checkout URL shape (priceId comes from the landing
  // page's Get Started button). Without a backend the RoleProvider holds the
  // app in its loading state; the route must still boot cleanly.
  await page.goto("/checkout?priceId=price_e2e_one_time");
  await expect(page.locator("#root")).not.toBeEmpty();

  await page.goto("/checkout/status?session_id=cs_e2e_placeholder");
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live one-time payment flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + webhook forwarding: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("buyer completes a one-time payment and lands on the success page", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Landing: the marketplace seed's one-time product (Sasha's $129
    // Ceramics Masterclass) is listed alongside the subscriptions.
    await page.goto("/");
    const oneTimeCard = page
      .locator("div")
      .filter({ hasText: /^Ceramics Masterclass/ })
      .last();
    await oneTimeCard.getByRole("button", { name: "Get Started" }).click();

    // Checkout page creates the session; the action derives payment mode
    // from the price's one_time type (BTS-57).
    await expect(page).toHaveURL(/\/checkout\?priceId=/);

    // Embedded Stripe checkout renders in an iframe; pay with the standard
    // test card. Selectors follow Stripe's embedded checkout form.
    const frame = page.frameLocator('iframe[src*="checkout.stripe.com"]');
    await frame.locator("#email").fill("billie@example.com");
    await frame.locator("#cardNumber").fill("4242424242424242");
    await frame.locator("#cardExpiry").fill("12 / 34");
    await frame.locator("#cardCvc").fill("123");
    await frame.locator("#billingName").fill("Billie Buyer");
    await frame.locator('button[type="submit"]').click();

    // Stripe substitutes {CHECKOUT_SESSION_ID} into the return URL.
    await page.waitForURL(/\/checkout\/status\?session_id=cs_/, {
      timeout: 60_000,
    });

    // Success page: the webhook flips the component session to `complete`,
    // and payment mode gets the one-time purchase copy.
    await expect(page.getByText("Payment successful!")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/purchase is complete/i)).toBeVisible();
  });
});
