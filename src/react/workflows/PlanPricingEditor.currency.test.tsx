// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanPricingEditor } from "./PlanPricingEditor.js";
afterEach(cleanup);
const plan = {
  id: "plan",
  name: "Plan",
  monthlyAmount: 500,
  feeBasisPoints: 500,
  affiliateBasisPoints: 4000,
  version: 1,
};

it.each([
  ["usd", 500, "5.00", "12.34", 1234, "decimal"],
  ["jpy", 500, "500", "600", 600, "numeric"],
  ["mga", 500, "500", "600", 600, "numeric"],
  ["isk", 50000, "500", "600", 60000, "numeric"],
  ["ugx", 50000, "500", "600", 60000, "numeric"],
  ["huf", 1045, "10.45", "12.34", 1234, "decimal"],
  ["twd", 1045, "10.45", "12.34", 1234, "decimal"],
  [
    "usd",
    Number.MAX_SAFE_INTEGER,
    "90071992547409.91",
    "90071992547409.91",
    Number.MAX_SAFE_INTEGER,
    "decimal",
  ],
])(
  "initializes and saves exact %s provider price units",
  async (currency, monthlyAmount, initial, input, expected, inputMode) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanPricingEditor
        plan={{ ...plan, currency, monthlyAmount }}
        onSave={onSave}
      />,
    );
    const field = screen.getByLabelText(
      `Monthly price (${currency.toUpperCase()})`,
    );
    expect(field).toHaveValue(initial);
    expect(field).toHaveAttribute("inputmode", inputMode);
    await userEvent.clear(field);
    await userEvent.type(field, input);
    await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
    expect(onSave).toHaveBeenCalledWith({
      monthlyAmount: expected,
      feeBasisPoints: 500,
      affiliateBasisPoints: 4000,
      expectedVersion: 1,
    });
  },
);

it.each([
  ["jpy", "0.5"],
  ["mga", "1.5"],
  ["isk", "1.01"],
  ["ugx", "1.01"],
  ["usd", "1.005"],
  ["usd", "90071992547409.92"],
  ["usd", "0"],
  ["usd", "1e2"],
  ["ZZZ", "1"],
  ["bhd", "1"],
])(
  "rejects invalid %s price %s before the callback",
  async (currency, value) => {
    const onSave = vi.fn();
    render(<PlanPricingEditor plan={{ ...plan, currency }} onSave={onSave} />);
    const field = screen.getByLabelText(
      `Monthly price (${currency.toUpperCase()})`,
    );
    await userEvent.clear(field);
    await userEvent.type(field, value);
    await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  },
);

it("resets currency-scoped headless fields and ignores a late previous save", async () => {
  let resolveOld: (() => void) | undefined;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const children = (
    state: Parameters<
      NonNullable<ComponentProps<typeof PlanPricingEditor>["children"]>
    >[0],
  ) => (
    <>
      <output>
        {state.monthlyPrice}|{state.isPending ? "pending" : "idle"}|
        {state.message ?? ""}
      </output>
      <button onClick={() => void state.save()}>Save</button>
      <button onClick={() => state.setMonthlyPrice("777")}>Edit</button>
    </>
  );
  const { rerender } = render(
    <PlanPricingEditor plan={{ ...plan, currency: "usd" }} onSave={onSave}>
      {children}
    </PlanPricingEditor>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status")).toHaveTextContent("pending");
  rerender(
    <PlanPricingEditor plan={{ ...plan, currency: "jpy" }} onSave={onSave}>
      {children}
    </PlanPricingEditor>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("500|idle|");
  await act(async () => resolveOld?.());
  expect(screen.getByRole("status")).toHaveTextContent("500|idle|");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenLastCalledWith({
    monthlyAmount: 500,
    feeBasisPoints: 500,
    affiliateBasisPoints: 4000,
    expectedVersion: 1,
  });
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  rerender(
    <PlanPricingEditor
      plan={{ ...plan, currency: "jpy", version: 2, monthlyAmount: 600 }}
      onSave={onSave}
    >
      {children}
    </PlanPricingEditor>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("600|idle|");
});

it("keeps currency-aware retries on the same plan version", async () => {
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
  expect(onSave).toHaveBeenNthCalledWith(2, {
    monthlyAmount: 500,
    feeBasisPoints: 500,
    affiliateBasisPoints: 4000,
    expectedVersion: 1,
  });
});
