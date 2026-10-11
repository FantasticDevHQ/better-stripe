import { expect, test } from "@playwright/test";

test("theme toggle changes page colors and persists across reload", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const toggle = page.getByRole("button", {
    name: /Switch to (light|dark) theme/,
  });
  await expect(toggle).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "Switch to light theme" })
      .isVisible()
  ) {
    await toggle.click();
  }
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
  );
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("body")).not.toHaveCSS(
    "background-color",
    /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
  );
  await expect(
    page.getByRole("button", { name: "Switch to light theme" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch to light theme" }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
  );
});
