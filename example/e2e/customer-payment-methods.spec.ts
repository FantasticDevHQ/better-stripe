import { expect, test } from "@playwright/test";

test.use({ video: "on", screenshot: "only-on-failure" });
test("customer adds a sandbox card, reloads, and removes only that card", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND,
    "Requires the seeded Stripe sandbox",
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "customer"),
  );
  await page.goto("/dashboard/payment-methods");
  const card = page.frameLocator(
    'iframe[title="Secure card payment input frame"]',
  );
  await card
    .getByRole("textbox", { name: "Credit or debit card number", exact: true })
    .fill("4242424242424242");
  await card
    .getByRole("textbox", {
      name: "Credit or debit card expiration date",
      exact: true,
    })
    .fill("0735");
  await card
    .getByRole("textbox", { name: "Credit or debit card CVC/CVV", exact: true })
    .fill("123");
  await card.getByRole("textbox", { name: "ZIP", exact: true }).fill("10001");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const saved = page.locator("main li").filter({ hasText: "(7/2035)" });
  await expect(saved).toHaveCount(1, { timeout: 30000 });
  await page.reload();
  await expect(saved).toHaveCount(1, { timeout: 30000 });
  await saved.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(saved).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("card-removed.png"),
    fullPage: true,
  });
});
