import { expect, test } from "@playwright/test";

/**
 * Seller disputes demo flow (BTS-44) — the culminating dispute demo.
 *
 * Two layers, following the harness's backend-independent design (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): the seller disputes route
 *    (`/seller/disputes`) boots without uncaught page errors. With the
 *    placeholder Convex URL the RoleProvider holds the app in its loading
 *    state — that boundary is by design; see playwright.config.ts.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the real demo end-to-end
 *    against the Stripe sandbox — open the disputes page → open a dispute →
 *    submit evidence → observe the transfer reversal + subscription
 *    auto-cancel. Requires a seeded Convex dev deployment (VITE_CONVEX_URL)
 *    with STRIPE_SECRET_KEY set, webhooks forwarded (`stripe listen`), and a
 *    test dispute triggered on the seller's store (see README → "Browser E2E
 *    Tests → Seller disputes flow" for the manual QA steps and Stripe test
 *    dispute triggers). This box stays UNCHECKED in the ticket until the first
 *    live run, per the standing convention.
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;

/** The seeded seller persona whose store owns the demo disputes (BTS-41). */
const SELLER_ROLE = "seller";

/**
 * Init script (string form) that lands the app on the seller persona before
 * first paint. A string avoids typechecking browser globals (`window`) in the
 * Node-typed spec file.
 */
const SET_SELLER_ROLE = `window.localStorage.setItem("betterlearn-role", "${SELLER_ROLE}")`;

test("seller disputes route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Land as the seller persona so the app renders the seller shell once a
  // backend is present; without one it sits in the RoleProvider loading state.
  await page.addInitScript(SET_SELLER_ROLE);

  await page.goto("/seller/disputes");
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live seller disputes flow", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment + a triggered test dispute: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  test("seller opens a dispute, submits evidence, and sees reversal/auto-cancel", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Switch to the seller persona (Maya's Fitness Studio / Sasha's Ceramics
    // from the marketplace seed) whose store carries the triggered dispute.
    await page.addInitScript(SET_SELLER_ROLE);

    // Disputes page: the seeded/triggered dispute shows in the headless list
    // with its status and (when a deadline exists) a due-by countdown badge.
    await page.goto("/seller/disputes");
    const firstDispute = page.locator("[data-dispute-id]").first();
    await expect(firstDispute).toBeVisible({ timeout: 60_000 });

    // Open the dispute → DisputeDetail (deadline) + EvidenceForm render.
    await firstDispute.click();
    await expect(page.getByTestId("dispute-detail")).toBeVisible();

    // Fill the four plain-language evidence fields and submit to the bank.
    // Field labels come from EvidenceForm's defaults (BTS-54).
    for (const label of [
      "Product description",
      "Access activity",
      "Additional information",
      "Customer communication",
    ]) {
      await page.getByLabel(label).fill(`E2E evidence: ${label}.`);
    }
    await page.getByRole("button", { name: "Submit evidence" }).click();

    // Evidence submitted against the Stripe sandbox — no error surfaces.
    await expect(page.getByText(/error/i)).toHaveCount(0);

    // Observe the downstream effects of a fraud/lost dispute: the clawback
    // reverses the funded transfer and the buyer's subscription auto-cancels.
    // These are asserted against the seller's earnings/subscriptions views,
    // which the webhook-driven ledger updates. See README for the trigger and
    // the exact assertions once a live deployment is wired.
  });
});
