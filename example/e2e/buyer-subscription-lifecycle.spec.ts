import { expect, test } from "@playwright/test";

const LIVE = !!process.env.E2E_LIVE_BACKEND;

test("buyer billing subscription route boots without uncaught page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/dashboard/billing");
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(
    pageErrors,
    `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
  ).toEqual([]);
});

test.describe("live buyer subscription lifecycle", () => {
  test.skip(
    !LIVE,
    "Requires seeded Convex + Stripe backend: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=…",
  );

  test("buyer pauses and resumes a subscription from the billing page", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/dashboard/billing");
    await expect(
      page.getByTestId("buyer-subscription-status"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("buyer-subscription-pause").click();
    await expect(
      page.getByTestId("buyer-subscription-action-message"),
    ).toContainText("pause subscription requested");

    await expect(page.getByTestId("buyer-subscription-status")).toContainText(
      /Paused|Active|Trial|Cancels at period end/,
      { timeout: 90_000 },
    );

    const resume = page.getByTestId("buyer-subscription-resume");
    if (await resume.isEnabled()) {
      await resume.click();
      await expect(
        page.getByTestId("buyer-subscription-action-message"),
      ).toContainText("resume subscription requested");
    }

    expect(
      pageErrors,
      `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
    ).toEqual([]);
  });
});
