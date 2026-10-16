import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { convex } from "./checkout-test-helpers";
test.use({ video: "on" });
async function setRate(page: Page, id: string, value: string) {
  const control = page.getByTestId(id);
  await control
    .getByRole("button", { name: "Percentage", exact: true })
    .click();
  await control.getByRole("spinbutton").fill(value);
  await control.getByRole("button", { name: "Save", exact: true }).click();
  await expect(control.getByRole("status")).toContainText("saved");
}
test("zero defaults, global inheritance, store overrides and icon clears", async ({
  page,
}, info) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded Stripe sandbox");
  test.setTimeout(90000);
  const users = convex("users/queries:list");
  const admin = users.find((u: { role: string }) => u.role === "admin");
  const store = convex("storefront/public/queries:listStores")[0];
  const originals = [
    convex("affiliateDefaults/queries:get"),
    convex("affiliateDefaults/queries:get", { sellerId: store.sellerId }),
  ];
  await page.addInitScript((sellerId) => {
    if (!localStorage.getItem("betterlearn-role"))
      localStorage.setItem("betterlearn-role", "admin");
    if (!localStorage.getItem("betterstripe-seller"))
      localStorage.setItem("betterstripe-seller", sellerId);
  }, store.sellerId);
  try {
    await page.goto("/admin/store-plans");
    await expect(
      page.getByRole("columnheader", { name: "Plan", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("plan-affiliate-growth")).toContainText(
      "Effective payout: 0%.",
    );
    await page
      .getByTestId("plan-affiliate-growth")
      .getByRole("button", { name: "Clear affiliate payout" })
      .click();
    await expect(
      page.getByTestId("plan-affiliate-growth").getByRole("status"),
    ).toContainText("cleared");
    await setRate(page, "platform-affiliate-default", "12");
    await expect(page.getByTestId("plan-affiliate-growth")).toContainText(
      "Effective payout: 12%.",
    );
    await setRate(page, "plan-affiliate-growth", "0");
    await expect(page.getByTestId("plan-affiliate-growth")).toContainText(
      "Effective payout: 0%.",
    );
    await page
      .getByTestId("plan-affiliate-growth")
      .getByRole("button", { name: "Clear affiliate payout" })
      .click();
    await expect(page.getByTestId("plan-affiliate-growth")).toContainText(
      "Effective payout: 12%.",
    );
    expect(
      await page
        .getByTestId("platform-affiliate-default")
        .getByRole("button", { name: "Clear affiliate payout" })
        .locator("svg")
        .count(),
    ).toBe(1);
    await page.screenshot({
      path: info.outputPath("admin-list-global-inherited.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Seller", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Products", exact: true })
      .click();
    await expect(page.getByTestId("store-affiliate-default")).toContainText(
      "Effective payout: 12% from global.",
    );
    await setRate(page, "store-affiliate-default", "5");
    await expect(
      page.getByTestId(`affiliate-rate-${store.products[0].stripeProductId}`),
    ).toContainText("Effective payout: 5% from store.");
    await page
      .getByTestId("store-affiliate-default")
      .getByRole("button", { name: "Clear affiliate payout" })
      .click();
    await expect(page.getByTestId("store-affiliate-default")).toContainText(
      "Effective payout: 12% from global.",
    );
    await page.screenshot({
      path: info.outputPath("seller-store-inherited.png"),
      fullPage: true,
    });
  } finally {
    for (const [index, original] of originals.entries()) {
      const sellerId = index === 1 ? store.sellerId : undefined;
      const current = convex("affiliateDefaults/queries:get", { sellerId });
      execFileSync(
        "pnpm",
        [
          "exec",
          "convex",
          "run",
          "affiliateDefaults/mutations:save",
          JSON.stringify({
            actorId: sellerId ?? admin._id,
            sellerId,
            affiliateBasisPoints: original.affiliateBasisPoints,
            affiliateFixedAmount: original.affiliateFixedAmount,
            expectedVersion: current.version,
          }),
        ],
        { encoding: "utf8" },
      );
    }
  }
});
