import { expect, test } from "@playwright/test";

/**
 * Admin Testing page — backend-independent boot spec (BTS-77).
 *
 * Mirrors `smoke.spec.ts`'s boundary: this only proves the route mounts and
 * survives without throwing when no live Convex/Stripe backend is configured
 * (see playwright.config.ts's placeholder `VITE_CONVEX_URL`). The whole app
 * (via `RoleProvider`) gates rendering on a `users.list` query that never
 * resolves against a placeholder deployment, so — same as every other route
 * — the page legitimately sits on its "Loading…" screen rather than actually
 * rendering the Testing page's cards; that's expected and intentionally not
 * asserted past the app-shell level here. Actually firing the real test-mode
 * webhook triggers requires a seeded, linked deployment and is covered by the
 * manual `e2e:webhooks` money-layer flow instead (see README →
 * "Money-layer assertions"), not this harness.
 */
test("admin Testing page boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // The admin pages are gated on the demo role stored in localStorage.
  await page.addInitScript(() => {
    localStorage.setItem("betterlearn-role", "admin");
  });

  await page.goto("/admin/testing");

  // React mounted: #root exists and rendered content (app shell or loading
  // state) — same bar as smoke.spec.ts, since RoleProvider holds every route
  // on its loading screen without a live backend.
  const root = page.locator("#root");
  await expect(root).toBeAttached();
  await expect(root).not.toBeEmpty();

  // No uncaught exceptions during boot — same bar as smoke.spec.ts.
  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});
