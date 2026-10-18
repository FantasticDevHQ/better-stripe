import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { expect, it, vi } from "vitest";
import { SellerPlan } from "../pages/seller/plan";

vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "seller" } }),
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name.endsWith("getState")) return null;
    if (name.endsWith("getPublishableKey")) return "pk_test_example";
    return [
      {
        id: "starter",
        name: "Starter",
        monthlyAmount: 950,
        effectiveBasisPoints: 0,
        feeLabel: "9%",
      },
    ];
  },
}));

it("formats fractional-dollar plan prices consistently with the package", () => {
  render(
    <MemoryRouter>
      <SellerPlan />
    </MemoryRouter>,
  );
  expect(screen.getByText("$9.50")).toBeVisible();
});
