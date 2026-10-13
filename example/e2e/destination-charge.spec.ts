import { expect, test } from "@playwright/test";
// Actual seller destination payment assertions live in marketplace-roles.spec.ts.
test("legacy destination demo opens the storefront without charging a fixed buyer", async ({
  page,
}) => {
  await page.goto("/demo/destination-charge");
  await expect(page).toHaveURL(/\/stores/);
  await expect(
    page.getByRole("heading", { name: "Shop our sellers" }),
  ).toBeVisible();
});
