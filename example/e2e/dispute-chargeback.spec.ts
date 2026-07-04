import { expect, test } from "@playwright/test";

/**
 * Dispute + chargeback lifecycle demo (BTS-82).
 *
 * The always-on layer only proves that the seller dispute route boots and the
 * shell mounts without uncaught app errors. The accept/chargeback path is live
 * gated because it requires a seeded Convex deployment, Stripe credentials, and
 * a real test dispute whose transfer reversals have been delivered by webhooks.
 */

const LIVE = !!process.env.E2E_LIVE_BACKEND;
const SET_SELLER_ROLE = `window.localStorage.setItem("betterlearn-role", "seller")`;

test("dispute chargeback route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.addInitScript(SET_SELLER_ROLE);
  await page.goto("/seller/disputes");
  await expect(page.locator("#root")).not.toBeEmpty();

  const appErrors = pageErrors.filter((e) => !/\bCONVEX\b/i.test(e.message));
  expect(
    appErrors,
    `Unexpected page errors:\n${appErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live dispute chargeback lifecycle", () => {
  test.skip(
    !LIVE,
    "Requires E2E_LIVE_BACKEND=1, VITE_CONVEX_URL, Stripe env, webhooks, and a triggered dispute",
  );

  test("seller accepts a dispute and sees chargeback clawback figures", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.addInitScript(SET_SELLER_ROLE);
    await page.goto("/seller/disputes");

    await page.getByTestId("dispute-row").first().click({ timeout: 60_000 });
    await expect(page.getByTestId("dispute-detail")).toBeVisible();
    await expect(page.getByTestId("chargeback-ledger")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("chargeback-reversed")).toContainText("-");

    await page.getByTestId("accept-dispute-button").click();
    await expect(page.getByTestId("accept-dispute-status")).toContainText(
      /accepted/i,
      { timeout: 60_000 },
    );
  });
});
