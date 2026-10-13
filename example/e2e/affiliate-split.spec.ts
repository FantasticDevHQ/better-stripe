import { expect, test } from "@playwright/test";
// Real referred/direct purchases and ledger assertions live in marketplace-roles.spec.ts.
test("legacy split links open the public storefront and retain referrals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/marketplace/split?ref=avery");
  await expect(page).toHaveURL(/\/stores\?ref=avery/);
  await expect(
    page.getByRole("heading", { name: "Shop our sellers" }),
  ).toBeVisible();
  await expect(page.getByText(/Referred by Avery Affiliate/)).toBeVisible();
  expect(errors).toEqual([]);
});
