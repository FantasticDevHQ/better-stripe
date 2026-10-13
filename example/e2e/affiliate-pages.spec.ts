import { expect, test } from "@playwright/test";

test("affiliate sidebar opens separate earnings, sales, and links pages", async ({
  page,
}) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox data");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "affiliate"),
  );
  await page.goto("/affiliate");
  await expect(
    page.getByRole("heading", { name: "Referral earnings", exact: true }),
  ).toBeVisible();
  for (const label of ["Gross", "Reversals & adjustments", "Net", "Paid out"]) {
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: label }).first(),
    ).toBeVisible();
  }
  await expect(page.getByText("Stripe account:")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("affiliate-earnings-cards.png"),
    fullPage: true,
  });
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("link", { name: "Referred sales", exact: true }).click();
  await expect(page).toHaveURL(/\/affiliate\/sales$/);
  await expect(
    page.getByRole("heading", { name: "Referred sales", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Referral earnings", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Referred sales", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const sales = page.locator("main tbody tr");
  await expect(sales.first()).toBeVisible();
  await expect(sales.first().locator("td").first()).toHaveText(
    /Maya's Fitness Studio|Sasha's Ceramics|Jordan's Design Shop/,
  );
  await expect(
    page.getByText("Store unavailable", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("affiliate-sales-stores.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Referred sales", exact: true }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Referral links", exact: true }).click();
  await expect(page).toHaveURL(/\/affiliate\/links$/);
  await expect(
    page.getByRole("heading", { name: "Referral links", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Referred sales", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('main a[href*="ref=avery"]').first()).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const referral = page.locator('main a[href*="ref=avery"]').first();
  const referralUrl = new URL(
    (await referral.getAttribute("href"))!,
    page.url(),
  ).href;
  await page
    .getByRole("button", { name: /^Copy referral link for/ })
    .first()
    .click();
  await expect(
    page.getByText("Referral link copied", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        navigator as unknown as { clipboard: { readText(): Promise<string> } }
      ).clipboard.readText(),
    ),
  ).toBe(referralUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/affiliate");
  await expect(page.getByText("Stripe account:")).toBeVisible();
  const body = await page.locator("body").boundingBox();
  const main = await page.locator("main").boundingBox();
  expect(body!.width).toBeLessThanOrEqual(390);
  expect(main!.x + main!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: test.info().outputPath("affiliate-earnings-mobile.png"),
    fullPage: true,
  });
});
