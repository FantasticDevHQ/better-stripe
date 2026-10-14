import { expect, test } from "@playwright/test";
test.use({ video: "on" });
test("admin updates plan pricing, sellers see it, and original sandbox pricing is restored", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(120000);
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "admin"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/store-plans");
  const form = page.getByRole("form", { name: "Starter pricing" });
  await expect(form).toBeVisible({ timeout: 15000 });
  const originalMonthly = await form
    .getByLabel("Monthly price (USD)")
    .inputValue();
  const originalFee = await form.getByLabel("Sale fee (%)").inputValue();
  const updatedPrice = (Number(originalMonthly) + 1).toFixed(2);
  try {
    await form.getByLabel("Monthly price (USD)").fill(updatedPrice);
    await form.getByLabel("Sale fee (%)").fill("7.5");
    await form.getByRole("button", { name: "Save pricing" }).click();
    await expect(form.getByRole("status")).toContainText("Pricing saved", {
      timeout: 30000,
    });
    await page.screenshot({
      path: testInfo.outputPath("admin-pricing.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Seller", exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/store-earnings/);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Billing", exact: true })
      .click();
    const starter = page
      .getByRole("main")
      .locator('[data-slot="card"]')
      .filter({
        has: page.locator('[data-slot="card-title"]', { hasText: "Starter" }),
      });
    await expect(starter).toContainText(`$${Number(updatedPrice)}`);
    await expect(starter).toContainText("7.5% per sale");
    await page.screenshot({
      path: testInfo.outputPath("seller-pricing.png"),
      fullPage: true,
    });
  } finally {
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Store plans", exact: true })
      .click();
    await expect(form).toBeVisible();
    await form.getByLabel("Monthly price (USD)").fill(originalMonthly);
    await form.getByLabel("Sale fee (%)").fill(originalFee);
    await form.getByRole("button", { name: "Save pricing" }).click();
    await expect(form.getByRole("status")).toContainText("Pricing saved", {
      timeout: 30000,
    });
    await expect(form.getByLabel("Monthly price (USD)")).toHaveValue(
      originalMonthly,
    );
    await expect(form.getByLabel("Sale fee (%)")).toHaveValue(originalFee);
    await page.screenshot({
      path: testInfo.outputPath("restored-pricing.png"),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
