import { expect, test } from "@playwright/test";
const LIVE = !!process.env.E2E_LIVE_BACKEND;
test("customer dashboard boots without uncaught page errors", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "customer"),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(errors).toEqual([]);
});
test("seller navigation owns store subscriptions and earnings", async ({
  page,
}) => {
  test.skip(!LIVE, "Requires seeded personas");
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  await page.goto("/seller");
  const nav = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  for (const [label, path] of [
    ["Subscriptions", "/demo/subscribe"],
    ["Earnings", "/demo/store-earnings"],
  ]) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(path));
    await expect(
      page.locator("main").getByRole("heading").first(),
    ).toBeVisible();
  }
});
