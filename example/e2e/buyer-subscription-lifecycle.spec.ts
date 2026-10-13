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

    await page.addInitScript(() =>
      localStorage.setItem("betterlearn-role", "customer"),
    );
    await page.goto("/dashboard/billing");
    await expect(page.getByTestId("buyer-subscription-status")).toBeVisible({
      timeout: 30_000,
    });

    // A previous interrupted run may have left test collection paused.
    const initialResume = page.getByTestId("buyer-subscription-resume");
    if (await initialResume.isEnabled()) {
      await initialResume.click();
      await expect(page.getByTestId("buyer-subscription-pause")).toBeEnabled({
        timeout: 90_000,
      });
    }
    await page.getByTestId("buyer-subscription-pause").click();
    await expect(
      page.getByTestId("buyer-subscription-action-message"),
    ).toContainText("pause subscription requested");

    await expect(page.getByTestId("buyer-subscription-status")).toContainText(
      "Collection paused",
      { timeout: 90_000 },
    );
    const resume = page.getByTestId("buyer-subscription-resume");
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(
      page.getByTestId("buyer-subscription-action-message"),
    ).toContainText("resume subscription requested");
    await expect(
      page.getByTestId("buyer-subscription-status"),
    ).not.toContainText("Collection paused", { timeout: 90_000 });
    await expect(page.getByTestId("buyer-subscription-pause")).toBeEnabled();

    expect(
      pageErrors,
      `Unexpected page errors:\n${pageErrors.map((e) => e.message).join("\n")}`,
    ).toEqual([]);
  });
});
