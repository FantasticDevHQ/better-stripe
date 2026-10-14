import { expect, test } from "@playwright/test";
test.use({ video: "on" });
test("public allocation helper renders a reconciled fee-first split", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "customer"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/allocation");
  const preview = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Fee-first allocation preview" }),
  });
  await expect(preview).toBeVisible();
  for (const label of [
    "Creator",
    "Collaborator",
    "Affiliate",
    "Fees (Stripe + platform)",
  ])
    await expect(preview.getByText(label, { exact: true })).toBeVisible();
  await expect(preview).toContainText("$54.60");
  await expect(preview.getByText("$18.20", { exact: true })).toHaveCount(2);
  await expect(preview).toContainText("$9.00");
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("allocation-preview.png"),
    fullPage: true,
  });
});
