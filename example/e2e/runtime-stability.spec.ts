import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
test("role context survives hot reload and the theme renders without script warnings", async ({
  page,
}) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded sandbox");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" ||
      message.text().includes("Encountered a script tag")
    )
      errors.push(message.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/seller/account?section=setup");
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "qa/2026-10-13/runtime-account.png",
    fullPage: true,
  });
  const file = "src/providers/role-context.tsx";
  const original = readFileSync(file, "utf8");
  try {
    const update = page.waitForEvent("console", {
      predicate: (message) =>
        message.text().includes("role-context.tsx") &&
        /hot updated|invalidate/.test(message.text()),
      timeout: 15000,
    });
    writeFileSync(file, original + "\n// HMR regression test\n");
    await update;
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Payouts", exact: true })
      .click();
    await expect(page.locator("main h1")).toBeVisible();
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Switch to light theme" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.screenshot({
      path: "qa/2026-10-13/runtime-payouts.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(file, original);
  }
});
