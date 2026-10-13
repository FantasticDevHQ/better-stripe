// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Storefront } from "./Storefront.js";
afterEach(cleanup);
it("preserves product, store, and referral attribution when selecting a price", async () => {
  const onSelectPrice = vi.fn();
  render(
    <Storefront
      stores={[
        {
          accountId: "acct_one",
          name: "Independent Store",
          products: [
            {
              stripeProductId: "prod_one",
              name: "Tee",
              prices: [
                {
                  stripePriceId: "price_one",
                  unitAmount: 2900,
                  currency: "usd",
                  type: "one_time",
                },
              ],
            },
          ],
        },
      ]}
      referralCode="avery"
      onSelectPrice={onSelectPrice}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Buy Tee" }));
  expect(onSelectPrice).toHaveBeenCalledWith(
    expect.objectContaining({
      store: expect.objectContaining({ accountId: "acct_one" }),
      price: expect.objectContaining({ stripePriceId: "price_one" }),
      referralCode: "avery",
    }),
  );
});
it("does not offer inactive prices or purchases when the application disables buying", () => {
  render(
    <Storefront
      canPurchase={false}
      stores={[
        {
          accountId: "acct_one",
          name: "Store",
          products: [
            {
              stripeProductId: "prod_one",
              name: "Tee",
              prices: [
                {
                  stripePriceId: "price_old",
                  active: false,
                  unitAmount: 100,
                  currency: "usd",
                  type: "one_time",
                },
                {
                  stripePriceId: "price_one",
                  unitAmount: 2900,
                  currency: "usd",
                  type: "one_time",
                },
              ],
            },
          ],
        },
      ]}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Buy Tee" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
