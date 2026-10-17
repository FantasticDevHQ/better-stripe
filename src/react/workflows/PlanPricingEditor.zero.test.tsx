// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseChargeAmount } from "../../client/charge-currency.js";
import { PlanPricingEditor } from "./PlanPricingEditor.js";

afterEach(cleanup);
const plan = {
  id: "original-plan",
  name: "Original",
  monthlyAmount: 0,
  feeBasisPoints: null,
  affiliateBasisPoints: 2500,
  version: 7,
};

it.each([
  ["jpy", "0", 0],
  ["usd", "0.00", 0],
  ["jpy", "100", 100],
])(
  "saves the exact original %s price %s through the native form",
  async (currency, display, amount) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanPricingEditor
        plan={{ ...plan, currency, monthlyAmount: amount }}
        onSave={onSave}
      />,
    );
    expect(parseChargeAmount(display, currency)).toBe(amount);
    expect(
      screen.getByLabelText(`Monthly price (${currency.toUpperCase()})`),
    ).toHaveValue(display);
    await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      monthlyAmount: amount,
      feeBasisPoints: null,
      affiliateBasisPoints: 2500,
      expectedVersion: 7,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Pricing saved");
  },
);

it.each(["jpy", "usd"])(
  "saves edited zero %s through the render-prop controller with an explicit zero fee",
  async (currency) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanPricingEditor
        plan={{ ...plan, currency, monthlyAmount: 100, feeBasisPoints: 0 }}
        onSave={onSave}
      >
        {(state) => (
          <>
            <button onClick={() => state.setMonthlyPrice("0")}>Zero</button>
            <button onClick={() => void state.save()}>Save</button>
            <output>{state.monthlyPrice}</output>
            {state.error && <p role="alert">{state.error}</p>}
          </>
        )}
      </PlanPricingEditor>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Zero" }));
    expect(screen.getByRole("status")).toHaveTextContent("0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      monthlyAmount: 0,
      feeBasisPoints: 0,
      affiliateBasisPoints: 2500,
      expectedVersion: 7,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);

it("retries zero with the original version after a failed save", async () => {
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error("Retry"))
    .mockResolvedValue(undefined);
  render(
    <PlanPricingEditor plan={{ ...plan, currency: "jpy" }} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Retry");
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenNthCalledWith(2, {
    monthlyAmount: 0,
    feeBasisPoints: null,
    affiliateBasisPoints: 2500,
    expectedVersion: 7,
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
