import { expect, test } from "@playwright/test";
test.use({ video: "on" });
test("affiliate sales pages navigate forward and back without duplicate rows", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_LIVE_BACKEND, "Requires seeded affiliate sales");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "affiliate"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/affiliate/sales");
  const nav = page.getByRole("navigation", {
    name: "Referred sales pagination",
  });
  const rows = page.getByRole("main").locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(nav.getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(nav.getByRole("button", { name: "Next" })).toBeEnabled();
  const firstPage = await rows.allTextContents();
  await page.screenshot({
    path: testInfo.outputPath("page-1.png"),
    fullPage: true,
  });
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(nav.getByRole("status")).toHaveText("Page 2");
  await expect(rows).toHaveCount(10);
  await expect(nav.getByRole("button", { name: "Previous" })).toBeEnabled();
  const secondPage = await rows.allTextContents();
  expect(secondPage.some((row) => firstPage.includes(row))).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("page-2.png"),
    fullPage: true,
  });
  await nav.getByRole("button", { name: "Previous" }).click();
  await expect(nav.getByRole("status")).toHaveText("Page 1");
  await expect(rows).toHaveCount(10);
  expect(await rows.allTextContents()).toEqual(firstPage);
  await expect(nav.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(errors).toEqual([]);
});
