import { expect, test } from "@playwright/test";

/**
 * Customer nav sidebar surfaces the Store Subscription & Store Earnings demo
 * routes (BTS-85). Both routes were fully built + routed in App.tsx but
 * missing from NAV_ITEMS, so they were reachable only by typing the URL.
 * (`subscription-payout.spec.ts` already boot-tests `/demo/subscribe` and
 * `/demo/store-earnings` directly — this spec is scoped to the nav wiring
 * itself, not re-asserting those routes boot.)
 *
 * Two layers, following the harness's backend-independent boundary (BTS-56):
 *
 * 1. Backend-independent (always runs, incl. CI): `/dashboard` — the entry
 *    point where the customer nav sidebar lives — boots without uncaught
 *    page errors with the customer role set. `RoleProvider` gates *every*
 *    route (including the sidebar itself) on a `users.list` Convex query
 *    that never resolves against the placeholder deployment (see
 *    playwright.config.ts and admin-testing.spec.ts), so with no live
 *    backend the app legitimately sits on its "Loading…" screen rather than
 *    rendering the sidebar. That means the nav links can't actually be
 *    clicked in this layer.
 *
 * 2. Live flow (gated on E2E_LIVE_BACKEND=1): drives the actual regression
 *    this ticket guards against — with a real backend the sidebar renders,
 *    so this clicks the "Store Subscription" and "Store Earnings" links from
 *    the customer role's nav and asserts the URL actually changes.
 */
const LIVE = !!process.env.E2E_LIVE_BACKEND;

const NEW_CUSTOMER_NAV_LINKS = [
  { label: "Store Subscription", path: "/demo/subscribe" },
  { label: "Store Earnings", path: "/demo/store-earnings" },
];

test("customer /dashboard (nav sidebar entry point) boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.addInitScript(() => {
    localStorage.setItem("betterlearn-role", "customer");
  });
  await page.goto("/dashboard");
  await expect(page.locator("#root")).not.toBeEmpty();

  // Same CONVEX connection-layer boundary as destination-charge.spec.ts:
  // the placeholder deployment surfaces a fatal on the client's socket,
  // not an app error.
  const appErrors = pageErrors.filter((e) => !/\bCONVEX\b/i.test(e.message));
  expect(
    appErrors,
    `Unexpected page errors:\n${appErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live customer nav — new demo links", () => {
  test.skip(
    !LIVE,
    "Sidebar only renders once RoleProvider's users.list query resolves: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  for (const { label, path } of NEW_CUSTOMER_NAV_LINKS) {
    test(`clicking "${label}" in the customer nav navigates to ${path}`, async ({
      page,
    }) => {
      const pageErrors: Error[] = [];
      page.on("pageerror", (err) => pageErrors.push(err));

      await page.addInitScript(() => {
        localStorage.setItem("betterlearn-role", "customer");
      });
      await page.goto("/dashboard");

      await page
        .getByRole("navigation")
        .getByRole("link", { name: label })
        .click();

      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expect(page.locator("#root")).not.toBeEmpty();

      expect(
        pageErrors,
        `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
      ).toEqual([]);
    });
  }
});
