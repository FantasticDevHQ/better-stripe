import { expect, test } from "@playwright/test";

test.use({ video: "on" });

test("affiliate earnings components match headless cards and amounts", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND,
    "Requires the seeded Stripe sandbox",
  );
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "affiliate"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let headlessText = "";
  let headlessLayout: unknown;
  for (const mode of ["headless", "components"]) {
    await page.goto(`/affiliate?example=${mode}`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Referral earnings", exact: true }),
    ).toBeVisible();
    await expect(main.getByRole("status")).toHaveCount(4);
    await expect(main.getByRole("status").first()).toContainText("$");
    for (const label of [
      "Gross",
      "Reversals & adjustments",
      "Net",
      "Paid out",
    ]) {
      await expect(main.getByText(label, { exact: true })).toBeVisible();
    }
    const body = await main.innerText();
    const content = body.slice(body.indexOf("Referral earnings"));
    if (mode === "headless") headlessText = content;
    else expect(content).toBe(headlessText);
    const cards = main.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(4);
    const layout = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
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
    if (mode === "headless") headlessLayout = layout;
    else expect(layout).toEqual(headlessLayout);
    await page.screenshot({
      path: testInfo.outputPath(`${mode}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
