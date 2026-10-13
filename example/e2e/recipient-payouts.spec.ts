import { expect, test } from "@playwright/test";
for (const role of ["seller", "affiliate"] as const) {
  test(`${role} sees its own balance, upcoming payouts, and previous payouts`, async ({
    page,
  }) => {
    test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox data");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (activeRole) => localStorage.setItem("betterlearn-role", activeRole),
      role,
    );
    await page.goto(`/${role}/payouts`);
    await expect(
      page.getByRole("heading", { name: "Payouts", exact: true }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(
      nav.getByRole("link", { name: "Payouts", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText("Ready for payout", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    for (const label of [
      "Available",
      "Pending",
      "Next payout",
      "Upcoming payouts",
      "Previous payouts",
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    const upcoming = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Upcoming payouts" });
    await expect(upcoming.getByText("paid", { exact: true })).toHaveCount(0);
    await expect(upcoming.getByText("failed", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await page.screenshot({
      path: `qa/2026-10-13/${role}-payouts.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const body = await page.locator("body").boundingBox();
    expect(body!.width).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
}
