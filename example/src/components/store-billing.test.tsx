import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { StoreInvoiceEstimate } from "./store-invoice-estimate";
import { StorePaymentSource } from "./store-payment-source";
import { SellerCosts } from "./seller-costs";
import { formatAmount } from "@/lib/format-amount";

const mocks = vi.hoisted(() => ({ action: vi.fn(), query: vi.fn() }));
vi.mock("convex/react", () => ({
  useAction: () => mocks.action,
  useQuery: (...args: unknown[]) => mocks.query(...args),
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "seller" } }),
}));
const sellerId = "seller" as Id<"users">;
beforeEach(() => {
  mocks.action.mockReset();
  mocks.query.mockReset();
});

describe("store billing", () => {
  it("shows an invoice estimate with links to the related cases", async () => {
    mocks.action.mockResolvedValue({
      currency: "usd",
      nextBillingAt: 1791849600000,
      total: 3700,
      lines: [
        { id: "plan", description: "Store plan", amount: 2900 },
        {
          id: "refund",
          description: "Refund adjustment",
          amount: 300,
          sourceType: "refund",
        },
        {
          id: "dispute",
          description: "Dispute adjustment",
          amount: 500,
          sourceType: "dispute",
        },
      ],
    });
    render(
      <MemoryRouter>
        <StoreInvoiceEstimate sellerId={sellerId} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View estimate" }));
    expect(await screen.findByText("$37.00")).toBeInTheDocument();
    expect(screen.getByText("$29.00")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Refund adjustment" }),
    ).toHaveAttribute("href", "/seller/refunds");
    expect(
      screen.getByRole("link", { name: "Dispute adjustment" }),
    ).toHaveAttribute("href", "/seller/disputes");
    expect(mocks.action).toHaveBeenCalledWith({ sellerId });
    expect(
      screen.getByRole("button", { name: "Refresh estimate" }),
    ).toBeEnabled();
  });
  it("allows retrying a failed estimate", async () => {
    mocks.action.mockRejectedValueOnce(new Error("Invoice unavailable"));
    render(
      <MemoryRouter>
        <StoreInvoiceEstimate sellerId={sellerId} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View estimate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invoice unavailable",
    );
    expect(screen.getByRole("button", { name: "View estimate" })).toBeEnabled();
  });
  it("requires explicit consent before enabling balance payments", async () => {
    mocks.query.mockReturnValue({ enabled: false });
    mocks.action.mockResolvedValue(null);
    render(<StorePaymentSource sellerId={sellerId} />);
    expect(
      screen.getByText("No balance payment authorization is active."),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: "Confirm balance payments",
    });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.action).toHaveBeenCalledWith({
        sellerId,
        enabled: true,
        consent: true,
      }),
    );
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    expect(button).toBeDisabled();
  });
  it("can switch back to a saved payment method and reports failures", async () => {
    mocks.query.mockReturnValue({ enabled: true });
    mocks.action.mockRejectedValue(new Error("Balance authorization failed"));
    render(<StorePaymentSource sellerId={sellerId} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use saved payment method" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Balance authorization failed",
    );
    expect(mocks.action).toHaveBeenCalledWith({
      sellerId,
      enabled: false,
      consent: undefined,
    });
    expect(
      screen.getByRole("button", { name: "Use saved payment method" }),
    ).toBeEnabled();
  });
  it("shows loading and empty states while filtering refund and dispute costs", () => {
    const { rerender } = render(<SellerCosts kind="refund" />);
    expect(screen.getByText("Loading costs…")).toBeInTheDocument();
    mocks.query.mockReturnValue([]);
    rerender(<SellerCosts kind="refund" />);
    expect(screen.getByText("No refund costs yet.")).toBeInTheDocument();
    const base = {
      currency: "usd",
      amountDue: 350,
      collectedAmount: 100,
      invoicedAmount: 50,
      outstanding: 200,
    };
    mocks.query.mockReturnValue([
      {
        ...base,
        _id: "refund",
        paymentIntentId: "pi_refund",
        sourceType: "refund",
        disputeFees: 0,
      },
      {
        ...base,
        _id: "dispute",
        paymentIntentId: "pi_dispute",
        disputeFees: 1500,
      },
    ]);
    rerender(<SellerCosts kind="refund" />);
    expect(screen.getByText("pi_refund")).toBeInTheDocument();
    expect(screen.queryByText("pi_dispute")).not.toBeInTheDocument();
    expect(screen.getByText("$3.50")).toBeInTheDocument();
    rerender(<SellerCosts kind="dispute" />);
    expect(screen.getByText("pi_dispute")).toBeInTheDocument();
    expect(screen.queryByText("pi_refund")).not.toBeInTheDocument();
    expect(formatAmount(12900, "usd")).toBe("$129.00");
  });
});
