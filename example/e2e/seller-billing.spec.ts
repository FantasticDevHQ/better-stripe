import { expect, test } from "@playwright/test";
test("seller billing follows account, estimates the invoice, and leaves costs with refunds and disputes", async ({
  page,
}) => {
  test.setTimeout(90000);
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/seller/plan");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    nav.getByRole("link", { name: "Billing", exact: true }),
  ).toBeVisible();
  const labels = await nav.getByRole("link").allTextContents();
  expect(labels[labels.indexOf("Account") + 1]).toBe("Billing");
  await expect(
    page.getByRole("heading", { name: "Refund & dispute costs" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "View estimate" }).click();
  await expect(page.getByText("Estimated total", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: "qa/2026-10-13/seller-billing-estimate.png",
    fullPage: true,
  });
  await nav.getByRole("link", { name: "Disputes", exact: true }).click();
  await expect(page.getByText("Dispute costs", { exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Refunds", exact: true }).click();
  await expect(page.getByText("Refund costs", { exact: true })).toBeVisible();
});

test("account combines setup and Stripe settings and balance payments require opt-in", async ({
  page,
}) => {
  test.setTimeout(90000);
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/seller/account");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    nav.getByRole("link", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Onboarding", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Marketplace Account", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Setup", exact: true }).click();
  await expect(page).toHaveURL(/section=setup/);
  await page.getByRole("tab", { name: "Stripe settings", exact: true }).click();
  await expect(page).toHaveURL(/section=stripe-settings/);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Stripe settings", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/seller/onboarding");
  await expect(page).toHaveURL(/\/seller\/account\?section=setup/);
  await page.goto("/seller/plan");
  await page
    .getByLabel("Seller persona")
    .selectOption({ label: "Sasha's Ceramics" });
  await expect(
    page.getByText("Pay with saved payment method", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm balance payments" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I authorize BetterStripe/ })
    .check();
  await page.getByRole("button", { name: "Confirm balance payments" }).click();
  await expect(
    page.getByText("Pay from Stripe balance", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: "qa/2026-10-13/seller-balance-payments.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use saved payment method" }).click();
  await expect(
    page.getByText("Pay with saved payment method", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
});
