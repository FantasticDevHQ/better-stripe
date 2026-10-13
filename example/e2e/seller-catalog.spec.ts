import { expect, test } from "@playwright/test";

test.use({ video: "on", screenshot: "only-on-failure" });
test("seller creates a priced product, visitors can find it, and archiving hides the price", async ({
  page,
}) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox sellers");
  test.setTimeout(120000);
  const name = `QA Tee ${Date.now()}`;
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/seller/products");
  await page
    .getByLabel("Seller persona")
    .selectOption({ label: "Maya's Fitness Studio" });
  await page
    .getByRole("button", { name: "Create Product", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Sandbox catalog test tee");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const product = page.locator("tr").filter({ hasText: name });
  await expect(product).toBeVisible({ timeout: 30000 });
  await product.getByText(name, { exact: true }).click();
  await product.getByRole("button", { name: "Add Price", exact: true }).click();
  await page.getByLabel("Amount (cents)", { exact: true }).fill("2900");
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "One-time", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const price = page.locator("tr").filter({ hasText: "$29.00" }).last();
  await expect(price).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Visitor", exact: true }).click();
  await expect(
    page.getByRole("link", { name: `Buy ${name}`, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Seller", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Products", exact: true })
    .click();
  await product.getByText(name, { exact: true }).click();
  await price.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(price).toContainText("Archived", { timeout: 30000 });
  await page.getByRole("button", { name: "Visitor", exact: true }).click();
  await expect(
    page.getByRole("link", { name: `Buy ${name}`, exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("catalog-price-archived.png"),
    fullPage: true,
  });
});
