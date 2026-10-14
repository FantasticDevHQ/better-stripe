// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanPricingEditor } from "./PlanPricingEditor.js";
afterEach(cleanup);
it("validates money and percentages before saving minor units", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <PlanPricingEditor
      plan={{
        id: "starter",
        name: "Starter",
        monthlyAmount: 900,
        feeBasisPoints: 900,
        version: 0,
      }}
      onSave={save}
    />,
  );
  const monthly = screen.getByLabelText("Monthly price (USD)");
  await userEvent.clear(monthly);
  await userEvent.type(monthly, "12.34");
  const fee = screen.getByLabelText("Sale fee (%)");
  await userEvent.clear(fee);
  await userEvent.type(fee, "7.5");
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(save).toHaveBeenCalledWith({
    monthlyAmount: 1234,
    feeBasisPoints: 750,
    affiliateBasisPoints: 0,
    expectedVersion: 0,
  });
  expect(screen.getByRole("status").textContent).toContain("saved");
  await userEvent.clear(fee);
  await userEvent.type(fee, "101");
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toMatch(/fee/i);
  await userEvent.clear(fee);
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(save).toHaveBeenLastCalledWith({
    monthlyAmount: 1234,
    feeBasisPoints: null,
    affiliateBasisPoints: 0,
    expectedVersion: 0,
  });
});
it("validates affiliate payout percentages and saves basis points", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <PlanPricingEditor
      plan={{
        id: "growth",
        name: "Growth",
        monthlyAmount: 4900,
        feeBasisPoints: 490,
        affiliateBasisPoints: 2000,
        version: 1,
      }}
      onSave={save}
    />,
  );
  const share = screen.getByLabelText("Affiliate payout (%)");
  await userEvent.clear(share);
  await userEvent.type(share, "12.5");
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(save).toHaveBeenLastCalledWith({
    monthlyAmount: 4900,
    feeBasisPoints: 490,
    affiliateBasisPoints: 1250,
    expectedVersion: 1,
  });
  await userEvent.clear(share);
  await userEvent.type(share, "100.001");
  await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toMatch(/affiliate/i);
});
