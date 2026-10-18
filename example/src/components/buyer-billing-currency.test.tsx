import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { expect, it, vi } from "vitest";
import { Billing } from "../pages/dashboard/billing";

vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "buyer" } }),
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name.endsWith("getAccountByUserId"))
      return { stripeAccountId: "acct_buyer" };
    if (name.endsWith("listInvoicesByUser"))
      return [
        {
          stripeInvoiceId: "in_jpy",
          amountPaid: 2500,
          currency: "jpy",
          status: "paid",
        },
      ];
    return [];
  },
}));

it.each(["headless", "components"] as const)(
  "shows original currency units in %s buyer billing",
  (integration) => {
    render(
      <MemoryRouter>
        <Billing integration={integration} />
      </MemoryRouter>,
    );
    expect(screen.getByText("¥2,500")).toBeVisible();
  },
);
