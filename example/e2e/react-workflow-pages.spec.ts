import { expect, test } from "@playwright/test";
const cases: Record<string, string[]> = {
  visitor: ["/stores", "/checkout", "/checkout/status"],
  customer: [
    "/stores",
    "/dashboard",
    "/dashboard/billing",
    "/dashboard/invoices",
    "/dashboard/payment-methods",
  ],
  affiliate: [
    "/affiliate",
    "/affiliate/sales",
    "/affiliate/links",
    "/affiliate/payouts",
  ],
  seller: [
    "/seller",
    "/seller/sales",
    "/demo/store-earnings",
    "/demo/subscribe",
    "/seller/products",
    "/seller/account?section=details",
    "/seller/account?section=setup",
    "/seller/account?section=stripe-settings",
    "/seller/plan",
    "/seller/refunds",
    "/seller/disputes",
    "/seller/payouts",
  ],
  admin: [
    "/admin",
    "/admin/products",
    "/admin/subscriptions",
    "/admin/webhooks",
    "/admin/setup",
    "/admin/testing",
  ],
};
for (const [persona, paths] of Object.entries(cases)) {
  test(`${persona} workflows render after package extraction`, async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LIVE_BACKEND,
      "Requires the seeded development sandbox",
    );
    test.setTimeout(120000);
    await page.addInitScript(
      (persona) => localStorage.setItem("betterlearn-role", persona),
      persona,
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      if (path === "/checkout" || path === "/checkout/status") {
        await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      } else {
        await expect(
          page.getByRole("main").getByRole("heading").first(),
        ).toBeVisible({ timeout: 15000 });
      }
      await expect(
        page.getByText("Something went wrong", { exact: true }),
      ).toHaveCount(0);
      expect(errors, `JavaScript errors on ${path}`).toEqual([]);
    }
  });
}
