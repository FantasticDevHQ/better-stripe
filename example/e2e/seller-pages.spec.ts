import { expect, test } from "@playwright/test";

/**
 * Seller pages — backend-independent boot specs (BTS-87).
 *
 * Mirrors `smoke.spec.ts`'s boundary: these only prove each route mounts and
 * survives without throwing when no live Convex/Stripe backend is configured
 * (see playwright.config.ts's placeholder `VITE_CONVEX_URL`). The whole app
 * (via `RoleProvider`) gates rendering on a `users.list` query that never
 * resolves against a placeholder deployment, so every route legitimately sits
 * on its "Loading…" screen rather than actually rendering; that's expected and
 * intentionally not asserted past the app-shell level here.
 */
test("seller pages boot without uncaught page errors", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // The seller pages are gated on the demo role stored in localStorage.
  await page.addInitScript(() => {
    localStorage.setItem("betterlearn-role", "seller");
  });

  for (const route of [
    "/seller",
    "/seller/onboarding",
    "/seller/payouts",
    "/seller/products",
    "/seller/account",
  ]) {
    await page.goto(route);

    // React mounted: #root exists and rendered content (app shell or loading
    // state) — same bar as smoke.spec.ts, since RoleProvider holds every route
    // on its loading screen without a live backend.
    const root = page.locator("#root");
    await expect(root).toBeAttached();
    await expect(root).not.toBeEmpty();
  }

  // No uncaught exceptions during boot or navigation — same bar as smoke.spec.ts.
  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});
