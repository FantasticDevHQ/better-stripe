import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
const live = !!process.env.E2E_LIVE_BACKEND;
test("seller and affiliate pages expose real Connect embedded examples", async ({
  page,
}) => {
  test.skip(!live, "Requires seeded Stripe sandbox");
  test.setTimeout(180000);
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "seller"),
  );
  const cases = [
    ["/seller/payouts", "payouts"],
    ["/demo/store-earnings", "balances"],
    ["/seller/sales", "payments"],
    ["/seller/refunds", "refunds"],
    ["/seller/disputes", "disputes"],
    ["/seller/account?section=details", "account"],
    ["/seller/account?section=setup", "onboarding"],
    ["/seller/account?section=stripe-settings", "notifications"],
  ];
  for (const [path, kind] of cases) {
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}example=embedded`);
    const example = page.getByTestId(`connect-example-${kind}`);
    await expect(example).toBeVisible();
    await expect(example.locator("iframe").first()).toBeAttached({
      timeout: 30000,
    });
    await expect(
      example.getByText("Component unavailable", { exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Affiliate", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Payouts", exact: true })
    .click();
  await page.getByRole("tab", { name: "Stripe embedded", exact: true }).click();
  await expect(page.getByTestId("connect-example-payouts")).toBeVisible();
  await expect(
    page.getByTestId("connect-example-payouts").locator("iframe").first(),
  ).toBeAttached({ timeout: 30000 });
});
test("all checkout types initialize against Stripe and show developer tradeoffs", async ({
  page,
}) => {
  test.skip(!live, "Requires seeded Stripe sandbox");
  test.setTimeout(180000);
  const stores = JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "convex", "run", "storefront/public/queries:listStores"],
      {
        encoding: "utf8",
      },
    ),
  );
  const price = stores
    .flatMap(
      (store: {
        products: { prices: { stripePriceId: string; type: string }[] }[];
      }) => store.products.flatMap((product) => product.prices),
    )
    .find((price: { type: string }) => price.type === "one_time").stripePriceId;
  await page.addInitScript(() =>
    localStorage.setItem("betterlearn-role", "visitor"),
  );
  for (const [mode, title] of [
    ["embedded", "Embedded Checkout"],
    ["custom", "Payment Element + Checkout Sessions"],
    ["payment-intent", "Payment Element + Payment Intents"],
    ["form", "Embedded Checkout Form"],
    ["redirect", "Hosted Checkout"],
  ]) {
    await page.goto(`/checkout?priceId=${price}&ref=avery&checkout=${mode}`);
    await expect(
      page.getByRole("button", { name: `Selected ${title}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Pros", { exact: true })).toBeVisible();
    await expect(page.getByText("Cons", { exact: true })).toBeVisible();
    if (mode === "redirect")
      await expect(
        page.getByRole("button", { name: "Continue to Stripe Checkout" }),
      ).toBeVisible({ timeout: 30000 });
    else
      await expect(page.locator("main iframe").first()).toBeAttached({
        timeout: 30000,
      });
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});
