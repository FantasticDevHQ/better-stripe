import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  currency: "jpy",
  amount: 500,
  update: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      id: "plan",
      name: "Plan",
      currency: mocks.currency,
      monthlyAmount: mocks.amount,
      feeBasisPoints: 500,
      affiliateBasisPoints: 4000,
      version: 2,
    },
  ],
  useAction: () => mocks.update,
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "admin_id" } }),
}));
vi.mock("@/components/affiliate-payout-control", () => ({
  GlobalAffiliateSettings: () => null,
  AffiliatePayoutControl: () => null,
}));
import { AdminStorePlans } from "../pages/admin/store-plans";
beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue(undefined);
});
it.each([
  ["jpy", 500, "500", "600", 600, "1"],
  ["isk", 50000, "500", "600", 60000, "1"],
  ["huf", 1045, "10.45", "12.34", 1234, "0.01"],
])(
  "uses package headless units for %s in the Vite editor",
  async (currency, amount, initial, input, expected, step) => {
    mocks.currency = currency;
    mocks.amount = amount;
    render(<AdminStorePlans />);
    const field = screen.getByLabelText(
      `Plan monthly price (${currency.toUpperCase()})`,
    );
    expect(field).toHaveValue(Number(initial));
    expect(field).toHaveAttribute("step", step);
    await userEvent.clear(field);
    await userEvent.type(field, input);
    await userEvent.click(screen.getByRole("button", { name: "Save pricing" }));
    expect(mocks.update).toHaveBeenCalledWith({
      monthlyAmount: expected,
      feeBasisPoints: 500,
      expectedVersion: 2,
      planId: "plan",
      adminId: "admin_id",
    });
  },
);
