import { expect, test } from "@playwright/test";

/**
 * Foundation smoke test (BTS-56).
 *
 * Verifies the example app boots in a real browser, mounts its React shell, and
 * survives client-side navigation without throwing — all WITHOUT a live backend.
 * The app gates rendering on Convex queries (see RoleProvider), so with no
 * deployment configured the data areas sit in their loading/empty state; that is
 * expected and intentionally not asserted here. Demo flows that need seeded data
 * are covered by later tickets against a separate Convex + Stripe test env.
 */
test("app shell boots and routes without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  // Landing route: the document loads and React mounts into #root.
  await page.goto("/");

  // Title is set in index.html — backend-independent.
  await expect(page).toHaveTitle(/better-stripe Example/);

  // React mounted: #root exists and rendered content (app shell or loading state).
  const root = page.locator("#root");
  await expect(root).toBeAttached();
  await expect(root).not.toBeEmpty();

  // Basic client-side routing: a non-root path also boots the shell.
  await page.goto("/checkout");
  await expect(page.locator("#root")).not.toBeEmpty();

  // No uncaught exceptions during boot or navigation. The Convex client is
  // pointed at a placeholder URL, so its websocket failures surface as console
  // warnings — not page errors — and are deliberately not asserted on.
  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});
