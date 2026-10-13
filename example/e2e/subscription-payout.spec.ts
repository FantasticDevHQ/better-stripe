import { expect, test } from "@playwright/test";
// Customer subscribe, manage, and seller subscriber assertions live in marketplace-roles.spec.ts.
test("seller subscription and earnings routes boot without page errors", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of ["/demo/subscribe", "/demo/store-earnings"]) {
    await page.goto(route);
    await expect(page.locator("#root")).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});
