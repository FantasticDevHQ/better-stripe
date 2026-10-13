import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// Stripe direct checkout stalls in headless Chromium on this sandbox.
// Run these opt-in payment checks in a normal browser, with video evidence.
test.use({ video: "on", screenshot: "only-on-failure", headless: false });
const LIVE = !!process.env.E2E_LIVE_BACKEND;
function convex(name: string, args = {}) {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "convex", "run", name, JSON.stringify(args)],
      { encoding: "utf8", timeout: 60_000 },
    ),
  );
}
async function role(page: Page, value: string) {
  await page.addInitScript(
    (value) => localStorage.setItem("betterlearn-role", value),
    value,
  );
}
async function pay(page: Page, email: string) {
  const frame = page.frameLocator('iframe[src*="embedded-checkout-inner"]');
  const cardChoice = frame.getByRole("button", {
    name: "Pay with card",
    exact: true,
  });
  await expect(
    frame.locator("#cardNumber").or(cardChoice).first(),
  ).toBeAttached({ timeout: 60000 });
  if (!(await frame.locator("#cardNumber").count()))
    await cardChoice.dispatchEvent("click");
  await expect(frame.locator("#cardNumber")).toBeVisible({ timeout: 60_000 });
  const usd = frame
    .getByRole("button")
    .filter({ has: frame.getByRole("img", { name: "US", exact: true }) });
  if ((await usd.count()) && (await usd.isEnabled())) await usd.click();
  if (
    (await frame.locator("#email").count()) &&
    (await frame.locator("#email").isEditable())
  )
    await frame.locator("#email").fill(email);
  await frame.locator("#cardNumber").fill("4242424242424242");
  await frame.locator("#cardExpiry").fill("12 / 34");
  await frame.locator("#cardCvc").fill("123");
  await frame.locator("#billingName").fill("Sandbox Test Buyer");
  await frame.locator("#billingName").press("Tab");
  const postal = frame.locator("#billingPostalCode");
  if (await postal.isVisible()) await postal.fill("10001");
  const submit = frame.getByRole("button", { name: /^(Pay|Subscribe)$/ });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL(/\/checkout\/status\?session_id=cs_/, {
    timeout: 90_000,
  });
  await expect(
    page.getByRole("heading", { name: "Payment successful!" }),
  ).toBeVisible({ timeout: 60_000 });
  return new URL(page.url()).searchParams.get("session_id")!;
}

test.describe("live marketplace roles and payments", () => {
  test.skip(!LIVE, "Requires the configured seeded Stripe sandbox");
  test.setTimeout(240_000);

  const pages: Record<string, string[]> = {
    visitor: ["/stores", "/checkout", "/checkout/status"],
    customer: [
      "/dashboard",
      "/dashboard/billing",
      "/dashboard/invoices",
      "/dashboard/payment-methods",
      "/stores",
    ],
    seller: [
      "/demo/store-earnings",
      "/demo/subscribe",
      "/seller",
      "/seller/products",
      "/seller/onboarding",
      "/seller/payouts",
      "/seller/disputes",
      "/seller/refunds",
      "/seller/account",
      "/seller/marketplace-account",
    ],
    affiliate: [
      "/affiliate",
      "/affiliate/sales",
      "/affiliate/links",
      "/affiliate/payouts",
    ],
    admin: [
      "/admin",
      "/admin/products",
      "/admin/subscriptions",
      "/admin/webhooks",
      "/admin/testing",
      "/admin/setup",
    ],
  };
  for (const [persona, paths] of Object.entries(pages)) {
    test(`${persona} pages render and keep finances in the correct role`, async ({
      page,
    }) => {
      await role(page, persona);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (
          m.type() === "error" &&
          !m
            .text()
            .startsWith(
              "Encountered a script tag while rendering React component.",
            )
        )
          errors.push(m.text());
      });
      for (const path of paths)
        await test.step(`It should render ${path}`, async () => {
          await page.goto(path);
          await expect(
            page.getByRole("navigation", {
              name: "Primary navigation",
              exact: true,
            }),
          ).toBeVisible({ timeout: 30_000 });
          await expect(page.locator("main")).not.toContainText(
            "Something went wrong",
          );
          await expect(
            page.locator("main").locator("h1, h2, [role=alert]").first(),
          ).toBeVisible({ timeout: 30_000 });
        });
      const nav = page.getByRole("navigation", {
        name: "Primary navigation",
        exact: true,
      });
      if (persona === "customer" || persona === "visitor") {
        await expect(nav.getByRole("link", { name: "Earnings" })).toHaveCount(
          0,
        );
        await expect(
          nav.getByRole("link", { name: "Affiliate Split" }),
        ).toHaveCount(0);
      }
      if (persona === "visitor")
        await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
      if (persona !== "admin") {
        await page.goto("/admin/setup");
        await expect(page).not.toHaveURL(/\/admin/);
      }
      await page.screenshot({
        path: `qa/2026-10-13/${persona}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }

  test("guest buys through Avery's link and seller, affiliate, and platform reconcile", async ({
    page,
  }) => {
    await role(page, "visitor");
    const stores = convex("storefront:listStores");
    const store = stores.find(
      (s: { name: string }) => s.name === "Sasha's Ceramics",
    );
    await page.goto(`/stores?store=${store.accountId}&ref=avery`);
    await expect(page.getByText(/Referred by Avery Affiliate/)).toBeVisible();
    await page.getByRole("link", { name: /^Buy / }).click();
    await expect(page).toHaveURL(/ref=avery/);
    const sessionId = await pay(page, "guest-qa@example.com");
    const session = convex("queries:getCheckoutSessionByStripeId", {
      stripeSessionId: sessionId,
    });
    expect(session.userId).toBe("");
    expect(session.mode).toBe("payment");
    const sale = convex("e2eCheckout:inspectSale", {
      stripeSessionId: sessionId,
    });
    expect(sale.amount).toBe(12900);
    expect(sale.paymentStatus).toBe("paid");
    await expect
      .poll(
        () =>
          convex("storeSaleSettlement:getByCharge", {
            chargeId: sale.chargeId,
          })?.status,
        { timeout: 90_000 },
      )
      .toBe("settled");
    const transfers = convex("queries:listTransfersByCharge", {
      sourceChargeId: sale.chargeId,
    });
    const settlement = convex("storeSaleSettlement:getByCharge", {
      chargeId: sale.chargeId,
    });
    expect(settlement.status).toBe("settled");
    expect(settlement.sellingFee).toBe(
      Math.max(Math.round(12900 * 0.049), settlement.processingFee),
    );
    expect(
      transfers
        .map((t: { amount: number }) => t.amount)
        .sort((a: number, b: number) => a - b),
    ).toEqual(
      [settlement.affiliateNet, settlement.sellerNet]
        .filter((amount) => amount > 0)
        .sort((a: number, b: number) => a - b),
    );
    expect(
      settlement.processingFee +
        settlement.platformNet +
        settlement.sellerNet +
        settlement.affiliateNet +
        (settlement.costRecoveryAmount ?? 0),
    ).toBe(sale.amount);
    await page.screenshot({
      path: "qa/2026-10-13/guest-referred-success.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Affiliate", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Referred sales" })
      .click();
    await expect(page.getByText(sale.chargeId)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("customer buys directly and only the seller receives the net", async ({
    page,
  }) => {
    await role(page, "customer");
    const stores = convex("storefront:listStores");
    const store = stores.find(
      (s: { name: string }) => s.name === "Maya's Fitness Studio",
    );
    await page.goto(`/stores?store=${store.accountId}`);
    await page.getByRole("link", { name: /^Buy / }).click();
    const sessionId = await pay(page, "alex@example.com");
    const session = convex("queries:getCheckoutSessionByStripeId", {
      stripeSessionId: sessionId,
    });
    expect(session.userId).toBe(
      convex("users:getByRole", { role: "customer" })._id,
    );
    const sale = convex("e2eCheckout:inspectSale", {
      stripeSessionId: sessionId,
    });
    expect(sale.amount).toBe(10000);
    await expect
      .poll(
        () =>
          convex("storeSaleSettlement:getByCharge", { chargeId: sale.chargeId })
            ?.status,
        { timeout: 90000 },
      )
      .toBe("settled");
    const settlement = convex("storeSaleSettlement:getByCharge", {
      chargeId: sale.chargeId,
    });
    expect(settlement.sellerAccountId).toBe(store.accountId);
    expect(settlement.sellingFee).toBe(Math.max(900, settlement.processingFee));
    expect(settlement.sellerNet).toBe(
      10000 - settlement.sellingFee - (settlement.costRecoveryAmount ?? 0),
    );
    expect(settlement.affiliateNet).toBe(0);
    await page.screenshot({
      path: "qa/2026-10-13/customer-direct-success.png",
      fullPage: true,
    });
  });

  test("customer subscribes to the seller and can manage their own subscription", async ({
    page,
  }) => {
    await role(page, "customer");
    const stores = convex("storefront:listStores");
    const store = stores.find(
      (s: { name: string }) => s.name === "Maya's Fitness Studio",
    );
    const monthly = store.products
      .flatMap((p: { prices: unknown[] }) => p.prices)
      .find((p: { interval?: string }) => p.interval === "month");
    await page.goto(`/checkout?priceId=${monthly.stripePriceId}`);
    const sessionId = await pay(page, "alex@example.com");
    const customer = convex("users:getByRole", { role: "customer" });
    const session = convex("queries:getCheckoutSessionByStripeId", {
      stripeSessionId: sessionId,
    });
    expect(session.userId).toBe(customer._id);
    expect(session.mode).toBe("subscription");
    await expect
      .poll(
        () =>
          convex("queries:listSubscriptionsByUser", {
            userId: customer._id,
          }).some(
            (s: { priceId: string; status: string }) =>
              s.priceId === monthly.stripePriceId && s.status === "active",
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
    await page.goto("/dashboard/billing");
    await expect(page.getByTestId("buyer-subscription-status")).toBeVisible();
    await page.getByTestId("buyer-subscription-pause").click();
    await expect(page.getByTestId("buyer-subscription-status")).toContainText(
      "Collection paused",
      { timeout: 90_000 },
    );
    await page.getByTestId("buyer-subscription-resume").click();
    await expect(
      page.getByTestId("buyer-subscription-status"),
    ).not.toContainText("Collection paused", { timeout: 90_000 });
    await page.getByRole("button", { name: "Seller", exact: true }).click();
    await page.getByRole("link", { name: "Subscriptions" }).click();
    await expect(page.locator("main")).toContainText("sub_", {
      timeout: 30_000,
    });
    await page.screenshot({
      path: "qa/2026-10-13/seller-subscribers.png",
      fullPage: true,
    });
  });
});
