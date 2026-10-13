import { expect, test } from "@playwright/test";

test.describe("live Express dashboard login", () => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND,
    "Requires the sandbox seller fixture to have completed Express onboarding",
  );

  test("seller opens their account-specific Stripe Express login", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("betterlearn-role", "seller");
    });
    await page.goto("/seller/account");
    await page
      .getByLabel("Seller persona")
      .selectOption({ label: "Jordan Seller" });
    await expect(
      page.getByRole("button", { name: "Open dashboard", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    // Match the account displayed by the app to the account in the generated
    // hosted dashboard URL. Never persist or report the single-use login URL.
    const accountId = (await page.locator("main").innerText()).match(
      /acct_[A-Za-z0-9]+/,
    )?.[0];
    expect(accountId).toBeTruthy();
    await page
      .getByRole("button", { name: "Open dashboard", exact: true })
      .click();
    await page.waitForURL(
      (url) =>
        url.hostname === "connect.stripe.com" &&
        (url.pathname.startsWith(`/internal_express_login/${accountId}/`) ||
          (url.pathname === "/app/express" && url.hash.includes(accountId!))),
      { timeout: 60_000, waitUntil: "domcontentloaded" },
    );
    // Stripe may challenge automated browsers with CAPTCHA. The default check
    // proves our app generated the correct account's hosted login handoff.
    // Full hosted verification is opt-in and must not bypass Stripe challenges.
    if (!process.env.E2E_STRIPE_HOSTED_LOGIN) return;
    await page.waitForURL(
      (url) =>
        url.hostname === "connect.stripe.com" &&
        url.pathname === "/app/express" &&
        url.hash.includes(accountId!),
      { timeout: 60_000 },
    );
    await expect(
      page.getByText(/Test mode|test account|test data/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page
        .getByRole("heading", { name: "Recent transactions", exact: true })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await page.screenshot({
      path: "/tmp/bts-express-login-fixed.png",
      fullPage: true,
    });
  });
});
