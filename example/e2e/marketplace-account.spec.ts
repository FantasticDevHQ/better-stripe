import { expect, test } from "@playwright/test";

/**
 * Marketplace account lifecycle demo (BTS-46): "one V2 account, configurations
 * accrue" — hosted Express onboarding as a recipient, add the customer
 * configuration, buy as the same account, then optionally add more
 * configurations later.
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): `/seller/marketplace-account`
 *    boots without uncaught page errors, both in its pre-onboarding state and
 *    when returning from a (placeholder) purchase session. With the
 *    placeholder Convex URL the app sits in its loading state — that
 *    boundary is by design; see playwright.config.ts. The page is
 *    role-gated (seller), so the role is preset via localStorage the same
 *    way admin-products.spec.ts (BTS-59) does for admin-gated pages.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo — seller
 *    onboards via hosted Stripe Express as a recipient, adds the customer
 *    configuration to the SAME account, then buys a seeded one-time
 *    platform price as that account. Requires a seeded Convex dev
 *    deployment (VITE_CONVEX_URL) with STRIPE_SECRET_KEY set and webhooks
 *    forwarded (`stripe listen`), so the account's onboarding status and
 *    the purchase's checkout-session status reach the component. See
 *    README → "Browser E2E Tests".
 *
 *    NOTE: the hosted Express onboarding form (identity + bank details) is
 *    Stripe-hosted UI outside this app's control; its exact field selectors
 *    are NOT verified against a live test-mode session in this change (no
 *    live Stripe access in this environment — see the AC note on the
 *    Linear ticket). Whoever runs this live for the first time should
 *    expect to adjust the `Onboard as a recipient (hosted Express)` phase's
 *    selectors against the actual rendered form before this test is
 *    reliable, then check the live-E2E AC box.
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("marketplace account route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // The page is gated on the demo role stored in localStorage, same as the
  // admin pages (BTS-59).
  await page.addInitScript(() => {
    localStorage.setItem("betterlearn-role", "seller");
  });

  await page.goto("/seller/marketplace-account");
  await expect(page.locator("#root")).not.toBeEmpty();

  // Returning from a self-purchase checkout session exercises the
  // CheckoutStatus render-prop branch without a live backend.
  await page.goto(
    "/seller/marketplace-account?purchase_session_id=cs_e2e_placeholder",
  );
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live marketplace account flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + webhook forwarding: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("seller onboards as recipient, adds customer config, and buys as the same account", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await page.addInitScript(() => {
      localStorage.setItem("betterlearn-role", "seller");
    });

    // --- Phase 1: onboard as a recipient via hosted Express. ---------------
    await page.goto("/seller/marketplace-account");
    await page.getByRole("button", { name: "Onboard as recipient" }).click();

    // Redirects to Stripe-hosted Express onboarding (connect.stripe.com).
    await page.waitForURL(/connect\.stripe\.com/, { timeout: 30_000 });

    // TODO(first live run): fill the hosted Express onboarding form. Stripe
    // test mode typically offers a fast-fill/"use test data" affordance on
    // each step (identity, business details, bank account) — verify the
    // current selectors against the live 2026-05-27.dahlia-era UI and
    // replace this block. Left unimplemented rather than guessed, per the
    // ticket's "structure + document, don't run live" instruction.

    // Stripe redirects back to returnUrl once onboarding is submitted.
    await page.waitForURL(/\/seller\/marketplace-account/, {
      timeout: 120_000,
    });

    // --- Phase 2: complete verification requirements if still pending. -----
    // Some test-mode accounts finish `complete` immediately after the hosted
    // form; others need a "Continue setup on Stripe" round-trip. Poll for
    // the completed state either way.
    await expect(page.getByText("All requirements met")).toBeVisible({
      timeout: 60_000,
    });

    // --- Phase 3: add the customer configuration to the same account. ------
    await page
      .getByRole("button", { name: "Add customer configuration" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Step 2 — Buy Something as This Account" }),
    ).toBeVisible({ timeout: 30_000 });

    // --- Phase 4: buy a seeded one-time platform price as this account. ----
    await page.getByRole("combobox").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Buy as this account" }).click();

    // Embedded/redirect Stripe Checkout — test card, same pattern as the
    // one-time-checkout demo (BTS-57).
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await page.locator("#email").fill("seller-as-buyer@example.com");
    await page.locator("#cardNumber").fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("Selling Seller");
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/purchase_session_id=cs_/, { timeout: 60_000 });
    await expect(page.getByText("Purchase complete")).toBeVisible({
      timeout: 60_000,
    });
  });
});
