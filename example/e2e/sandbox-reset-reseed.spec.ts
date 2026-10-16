import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

// Explicit additional opt-in: this test intentionally clears the demo database.
test.use({
  headless: process.env.E2E_HEADLESS === "1",
  video: "on",
  screenshot: "only-on-failure",
});
function convex(name: string) {
  return JSON.parse(
    execFileSync("pnpm", ["exec", "convex", "run", name, "{}"], {
      encoding: "utf8",
      timeout: 60000,
    }),
  );
}
test("reset and fresh reseed finish automatically, then rerun without duplicate personas", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_LIVE_BACKEND || process.env.E2E_RESET_SANDBOX !== "1",
    "Requires an explicitly disposable Stripe sandbox",
  );
  test.setTimeout(720000);
  expect(convex("queries:getStripeMode")).toBe("test");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "admin"),
  );
  await test.step("Reset the example and keep setup accessible", async () => {
    await page.goto("/admin/setup");
    await page
      .getByRole("button", { name: "Reset All Data", exact: true })
      .click();
    await expect(
      page.getByText(
        "No data found. Seed demo data to create users and products.",
      ),
    ).toBeVisible({ timeout: 60000 });
    expect(convex("queries:getSeedStatus").userCount).toBe(0);
  });
  await test.step("Seed accounts and populate all real Stripe fixtures without manually resuming", async () => {
    await page.getByRole("button", { name: "Seed Data", exact: true }).click();
    // Account/catalog provisioning precedes the resumable activity job. Start
    // its observation window when that job exists; keep the overall test cap.
    await expect(
      page.getByRole("progressbar", { name: "Sandbox fixture progress" }),
    ).toBeVisible({ timeout: 600000 });
    await Promise.race([
      page
        .getByRole("button", { name: "Fixtures populated", exact: true })
        .waitFor({ timeout: 600000 }),
      page
        .getByRole("button", { name: "Resume fixtures", exact: true })
        .waitFor({ timeout: 600000 })
        .then(async () => {
          throw new Error(
            `Fresh population failed: ${await page.getByRole("main").innerText()}`,
          );
        }),
    ]);
    const job = convex("sandboxFixtureState:status");
    expect(job.status).toBe("complete");
    expect(job.cursor).toBe(job.total);
    expect(convex("queries:getSeedStatus").userCount).toBe(8);
  });
  await test.step("Rerun the seed without duplicating users or fixture work", async () => {
    await page.getByRole("button", { name: "Seed Data", exact: true }).click();
    await expect(page.getByText("Demo data seeded successfully.")).toBeVisible({
      timeout: 60000,
    });
    expect(convex("queries:getSeedStatus").userCount).toBe(8);
    expect(convex("sandboxFixtureState:status").status).toBe("complete");
    expect(errors).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("reseed-complete.png"),
      fullPage: true,
    });
  });
});
