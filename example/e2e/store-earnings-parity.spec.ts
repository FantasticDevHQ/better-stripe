import { expect, test } from "@playwright/test";

test.use({ video: "on" });

test("seller earnings components match headless balance and payout cards", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND,
    "Requires seeded seller sandbox accounts",
  );
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let headlessText = "";
  let headlessLayout: unknown;
  for (const mode of ["headless", "components"]) {
    await page.goto(`/demo/store-earnings?example=${mode}`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Earnings", exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Available", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(main.getByText("Pending", { exact: true })).toBeVisible();
    await expect(
      main.getByRole("columnheader", { name: "Payout ID" }),
    ).toBeVisible();
    await expect(main.getByText("Loading earnings…")).toHaveCount(0);
    const text = await main.innerText();
    const content = text.slice(text.indexOf("Earnings"));
    if (mode === "headless") headlessText = content;
    else expect(content).toBe(headlessText);
    const cards = main.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(2);
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
    if (mode === "headless") headlessLayout = layout;
    else expect(layout).toEqual(headlessLayout);
    await page.screenshot({
      path: testInfo.outputPath(`${mode}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
