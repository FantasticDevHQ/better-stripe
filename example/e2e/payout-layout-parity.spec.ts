import { expect, test } from "@playwright/test";
test.use({ video: "on" });
for (const persona of ["affiliate", "seller"]) {
  test(`${persona} payout components match API cards and layout`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !process.env.E2E_LIVE_BACKEND,
      "Requires seeded Stripe sandbox accounts",
    );
    await page.addInitScript(
      (role) => localStorage.setItem("betterlearn-role", role),
      persona,
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let apiText = "";
    let apiLayout: unknown;
    for (const mode of ["headless", "components"]) {
      await page.goto(`/${persona}/payouts?example=${mode}`);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Payouts", exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled({ timeout: 30000 });
      const cards = main.locator('[data-slot="card"]');
      await expect(cards).toHaveCount(5);
      for (const label of [
        "Available",
        "Pending",
        "Next payout",
        "Upcoming payouts",
        "Previous payouts",
      ]) {
        await expect(main.getByText(label, { exact: true })).toBeVisible();
      }
      const text = await main.getByRole("tabpanel").innerText();
      const layout = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          const style = node.ownerDocument.defaultView!.getComputedStyle(node);
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            background: style.backgroundColor,
            radius: style.borderRadius,
            padding: style.padding,
            gap: style.gap,
          };
        }),
      );
      if (mode === "headless") {
        apiText = text;
        apiLayout = layout;
      } else {
        expect(text).toBe(apiText);
        expect(layout).toEqual(apiLayout);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${mode}.png`),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}
