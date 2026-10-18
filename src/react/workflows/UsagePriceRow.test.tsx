// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import * as ui from "../index.js";
import type { UsagePriceBinding } from "../../client/usage/catalogRead.js";
afterEach(cleanup);
const price: UsagePriceBinding = {
  pricingMode: "metered",
  stripePriceId: "price_usage",
  stripeProductId: "prod_usage",
  meterId: "mtr_usage",
  active: true,
  currency: "usd",
  billingScheme: "per_unit",
  unitAmountDecimal: "0.00125",
  tiers: [],
  interval: "month",
  plan: {
    key: "calls",
    version: "v1",
    model: "pay_as_you_go",
    unit: { name: "call", precision: 2 },
    rate: { currency: "usd", unitAmountDecimal: "0.125" },
  },
};
it("reuses ordinary PriceCard formatting for fixed prices", () => {
  expect(ui.UsagePriceRow).toBeTypeOf("function");
  render(
    <ui.UsagePriceRow
      value={{
        kind: "fixed",
        price: {
          stripePriceId: "price_fixed",
          unitAmount: 900,
          currency: "usd",
          type: "recurring",
          interval: "month",
          active: true,
        },
      }}
    />,
  );
  expect(screen.getByText("Fixed price")).toBeTruthy();
  expect(screen.getByText("$9.00/month")).toBeTruthy();
});
it("shows exact whole-unit metered rates and the original version instead of treating null amount as free", () => {
  expect(ui.UsagePriceRow).toBeTypeOf("function");
  render(<ui.UsagePriceRow value={{ kind: "metered", price }} />);
  expect(screen.getByText(/0.00125 USD per call/)).toBeTruthy();
  expect(screen.getByText(/v1/)).toBeTruthy();
  expect(screen.getByText(/sum aggregation/)).toBeTruthy();
});
it("labels supported managed graduated tiers separately from other tiers and transformations", () => {
  expect(ui.UsagePriceRow).toBeTypeOf("function");
  const { rerender } = render(
    <ui.UsagePriceRow
      value={{
        kind: "metered",
        price: {
          ...price,
          billingScheme: "tiered",
          plan: {
            ...price.plan,
            model: "included_overage",
            includedQuantity: "100",
            reset: "billing_period",
          },
        },
      }}
    />,
  );
  expect(screen.getByText(/100 included/)).toBeTruthy();
  rerender(
    <ui.UsagePriceRow value={{ kind: "unsupported", reason: "tiered" }} />,
  );
  expect(screen.getByText(/Unsupported tiered pricing/)).toBeTruthy();
  expect(screen.queryByText(/0.00/)).toBeNull();
  rerender(
    <ui.UsagePriceRow value={{ kind: "unsupported", reason: "transformed" }} />,
  );
  expect(screen.getByText(/Unsupported transformed pricing/)).toBeTruthy();
});
it("does not let legacy fixed rows misrepresent metered, tiered, transformed or missing amounts", () => {
  expect(ui.UsagePriceRow).toBeTypeOf("function");
  const fixed = {
    stripePriceId: "price_bad",
    currency: "usd",
    type: "recurring",
    interval: "month",
    active: true,
    unitAmount: 0,
  };
  const { rerender } = render(
    <ui.UsagePriceRow
      value={{ kind: "fixed", price: { ...fixed, usageType: "metered" } }}
    />,
  );
  expect(screen.getByText(/Unsupported pricing terms/)).toBeTruthy();
  rerender(
    <ui.UsagePriceRow
      value={{ kind: "fixed", price: { ...fixed, billingScheme: "tiered" } }}
    />,
  );
  expect(screen.queryByText("$0.00/month")).toBeNull();
  rerender(
    <ui.UsagePriceRow
      value={{
        kind: "fixed",
        price: { ...fixed, transformQuantity: { divideBy: 100 } },
      }}
    />,
  );
  expect(screen.queryByText("$0.00/month")).toBeNull();
  rerender(
    <ui.UsagePriceRow
      value={{ kind: "fixed", price: { ...fixed, unitAmount: null } }}
    />,
  );
  expect(screen.queryByText("$0.00/month")).toBeNull();
});
it("keeps unsupported fixed charge currency and increments unavailable without crashing", () => {
  expect(ui.UsagePriceRow).toBeTypeOf("function");
  const price = {
    stripePriceId: "price_bad",
    unitAmount: 1,
    currency: "bhd",
    type: "one_time",
    active: true,
  };
  const { rerender } = render(
    <ui.UsagePriceRow value={{ kind: "fixed", price }} />,
  );
  expect(screen.getByText(/Unsupported pricing terms/)).toBeTruthy();
  rerender(
    <ui.UsagePriceRow
      value={{ kind: "fixed", price: { ...price, currency: "isk" } }}
    />,
  );
  expect(screen.getByText(/Unsupported pricing terms/)).toBeTruthy();
});
