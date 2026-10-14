import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
export function convex(name: string, args = {}) {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "convex", "run", name, JSON.stringify(args)],
      { encoding: "utf8", timeout: 60000 },
    ),
  );
}
export async function fillPayment(page: Page, cardNumber = "4242424242424242") {
  const deadline = Date.now() + 45000;
  let filledOnce = false;
  while (Date.now() < deadline) {
    let foundCard = false;
    for (const frame of page.frames()) {
      const choose = frame.getByRole("button", {
        name: "Pay with card",
        exact: true,
      });
      if (
        (await choose.count().catch(() => 0)) &&
        !(await frame
          .locator("#cardNumber")
          .count()
          .catch(() => 0))
      )
        await choose.dispatchEvent("click").catch((error) => {
          if (!frame.isDetached()) throw error;
        });
      const card = frame.getByRole("button", { name: "Card", exact: true });
      if (await card.isVisible().catch(() => false)) await card.click();
      const country = frame
        .getByRole("combobox", { name: /^Country(?: or region)?$/i })
        .first();
      if (await country.isVisible().catch(() => false))
        await country.selectOption({ label: "United States" });
      for (const [selector, value] of [
        [
          '#checkout-email, #payment-email, #email, input[name="email"]',
          "checkout-example@example.com",
        ],
        ['#cardNumber, input[name="number"]', cardNumber],
        ['#cardExpiry, input[name="expiry"]', "1234"],
        ['#cardCvc, input[name="cvc"]', "123"],
        ['#billingName, input[name="name"]', "Sandbox Test Buyer"],
        [
          '#billingPostalCode, input[name="postalCode"], input[autocomplete="postal-code"]',
          "10001",
        ],
      ]) {
        const input = frame.locator(selector).first();
        if (await input.isVisible().catch(() => false)) {
          if (await input.isEditable()) await input.fill(value);
          if (selector.includes("cardNumber")) foundCard = true;
        }
      }
    }
    if (foundCard && filledOnce) return;
    filledOnce = foundCard;
    await page.waitForTimeout(500);
  }
  throw new Error("No Stripe card input became available");
}
