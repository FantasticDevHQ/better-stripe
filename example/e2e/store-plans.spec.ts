import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
test.use({ headless: false, video: "on", screenshot: "only-on-failure" });
const LIVE = !!process.env.E2E_LIVE_BACKEND;
function convex(name: string, args = {}) {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "convex", "run", name, JSON.stringify(args)],
      { encoding: "utf8", timeout: 60000 },
    ),
  );
}
test("header shows requested role order and theme after the persona name", async ({
  page,
}) => {
  await page.goto("/stores");
  const header = page.locator("header");
  await expect(
    header
      .getByRole("button")
      .filter({ hasText: /^(Visitor|Customer|Affiliate|Seller|Admin)$/ }),
  ).toHaveText(["Visitor", "Customer", "Affiliate", "Seller", "Admin"]);
  await expect(header.getByRole("button").last()).toHaveAttribute(
    "aria-label",
    /Switch to .* theme/,
  );
  await expect(header).toContainText("BetterStripe");
  if (LIVE) {
    await header.getByRole("button", { name: "Seller", exact: true }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Primary navigation", exact: true })
        .getByLabel("Seller persona"),
    ).toBeVisible();
    await expect(header.getByLabel("Seller persona")).toHaveCount(0);
  }
  await page.screenshot({ path: "qa/2026-10-13/betterstripe-header.png" });
});
test.describe("live monthly seller billing", () => {
  test.skip(!LIVE, "Requires the configured Stripe sandbox");
  test.setTimeout(240000);
  for (const [name, plan] of [
    ["Maya's Fitness Studio", "Starter"],
    ["Sasha's Ceramics", "Growth"],
    ["Jordan Seller", "Pro"],
  ]) {
    test(`${name} buys ${plan} and activates only after payment`, async ({
      page,
    }) => {
      await page.addInitScript(() =>
        localStorage.setItem("betterlearn-role", "seller"),
      );
      await page.goto("/seller/plan");
      await page.getByLabel("Seller persona").selectOption({ label: name });
      await expect(
        page.getByRole("heading", { name: "Billing", exact: true }),
      ).toBeVisible();
      const users = convex("users/queries:list");
      const seller = users.find(
        (u: { storeName?: string; name: string }) =>
          (u.storeName ?? u.name) === name,
      );
      const before = convex("storePlans/billing/public/queries:getState", {
        sellerId: seller._id,
      });
      if (!before.hasAccess) {
        await expect(
          page.getByText("Your store is closed", { exact: false }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: `Choose ${plan}`, exact: true })
          .click();
        const frame = page.frameLocator(
          'iframe[src*="embedded-checkout-inner"]',
        );
        const cardChoice = frame.getByRole("button", {
          name: "Pay with card",
          exact: true,
        });
        await cardChoice.waitFor({ state: "attached", timeout: 60000 });
        // Stripe's accordion cover has no layout box in Chromium automation.
        // Dispatch its normal click handler, then verify the actual card fields.
        await cardChoice.dispatchEvent("click");
        await expect(frame.locator("#cardNumber")).toBeVisible({
          timeout: 60000,
        });
        await frame.locator("#cardNumber").fill("4242424242424242");
        await frame.locator("#cardExpiry").fill("12 / 34");
        await frame.locator("#cardCvc").fill("123");
        await frame.locator("#billingName").fill("Sandbox Store Seller");
        await frame.locator("#billingName").press("Tab");
        const postal = frame.locator("#billingPostalCode");
        if (await postal.isVisible()) await postal.fill("10001");
        await frame
          .getByRole("button", { name: "Subscribe", exact: true })
          .click();
        await page.waitForURL(/\/seller\/plan\?session_id=cs_/, {
          timeout: 90000,
        });
        // Verify the same seller after the Stripe redirect.
        await page.getByLabel("Seller persona").selectOption({ label: name });
      }
      await expect(
        page.getByText(`Your ${plan.toLowerCase()} plan is active.`),
      ).toBeVisible({ timeout: 60000 });
      const after = convex("storePlans/billing/public/queries:getState", {
        sellerId: seller._id,
      });
      expect(after.hasAccess).toBe(true);
      expect(after.storePlan.planId).toBe(plan.toLowerCase());
      await page.screenshot({
        path: `qa/2026-10-13/store-plan-${plan.toLowerCase()}.png`,
      });
    });
  }
});

test("seller sales has its own menu item and follows the store selector", async ({
  page,
}) => {
  test.skip(!LIVE, "Requires the configured backend");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/demo/store-earnings");
  await expect(page.getByText("Sales & fees", { exact: true })).toHaveCount(0);
  const nav = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  await nav.getByRole("link", { name: "Sales", exact: true }).click();
  await expect(page).toHaveURL(/\/seller\/sales$/);
  await expect(
    page.getByRole("heading", { name: "Sales", exact: true }),
  ).toBeVisible();
  await nav
    .getByLabel("Seller persona")
    .selectOption({ label: "Sasha's Ceramics" });
  await expect(
    page.getByRole("cell", { name: "$129.00", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "qa/2026-10-13/seller-sales.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation menu", exact: true })
    .click();
  const mobile = page.getByRole("navigation", {
    name: "Mobile navigation",
    exact: true,
  });
  await expect(mobile.getByLabel("Seller persona")).toBeVisible();
  await expect(
    mobile.getByRole("link", { name: "Sales", exact: true }),
  ).toBeVisible();
});
