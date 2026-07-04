import { expect, test } from "@playwright/test";

/**
 * Dashboard payment methods — backend-independent boot spec (BTS-90).
 *
 * Mirrors `smoke.spec.ts` / `admin-products.spec.ts`'s boundary: only proves
 * the route mounts and survives without throwing when no live Convex/Stripe
 * backend is configured (see playwright.config.ts's placeholder
 * `VITE_CONVEX_URL`). The app (via `RoleProvider`) gates rendering on a
 * `users.list` query that never resolves against a placeholder deployment,
 * so the page legitimately sits on its "Loading…" screen rather than
 * actually rendering the add-card/list/no-account states; that's expected
 * and intentionally not asserted past the app-shell level here. The
 * load-failure / attach / delete error-surfacing added in BTS-90 needs a
 * live backend to trigger a real failure and isn't covered by this boot
 * spec.
 */
test("dashboard Payment Methods page boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // The dashboard pages are gated on the demo role stored in localStorage.
  await page.addInitScript(() => {
    localStorage.setItem("betterlearn-role", "customer");
  });

  await page.goto("/dashboard/payment-methods");

  // React mounted: #root exists and rendered content (app shell or loading
  // state) — same bar as smoke.spec.ts.
  const root = page.locator("#root");
  await expect(root).toBeAttached();
  await expect(root).not.toBeEmpty();

  // No uncaught exceptions during boot — same bar as smoke.spec.ts.
  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});
