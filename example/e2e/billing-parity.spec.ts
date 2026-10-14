import { expect, test } from "@playwright/test";

test.use({ video: "on" });

test("customer billing components match headless details and controls", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND,
    "Requires seeded sandbox subscriptions",
  );
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "customer"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let headlessText = "";
  for (const mode of ["headless", "components"]) {
    await page.goto(`/dashboard/billing?example=${mode}`);
    await expect(page.getByTestId("buyer-subscription-status")).toBeVisible({
      timeout: 30000,
    });
    const shell = page.getByTestId("buyer-subscription-shell");
    for (const action of [
      "portal",
      "pause",
      "resume",
      "reactivate",
      "cancel",
      "plan-change",
      "quantity-change",
      "trial-end-update",
      "trial-end-now",
    ]) {
      await expect(
        shell.getByTestId(`buyer-subscription-${action}`),
      ).toBeVisible();
    }
    const text = await shell.innerText();
    if (mode === "headless") headlessText = text;
    else expect(text).toBe(headlessText);
    await page.screenshot({
      path: testInfo.outputPath(`${mode}-billing.png`),
      fullPage: true,
    });
    await testInfo.attach(`${mode}-billing`, {
      path: testInfo.outputPath(`${mode}-billing.png`),
      contentType: "image/png",
    });
    await shell.getByTestId("buyer-subscription-quantity-input").fill("1.5");
    await shell.getByTestId("buyer-subscription-quantity-change").click();
    await expect(
      shell.getByTestId("buyer-subscription-action-message"),
    ).toHaveText("Enter a positive integer quantity.");
  }
  expect(errors).toEqual([]);
});
