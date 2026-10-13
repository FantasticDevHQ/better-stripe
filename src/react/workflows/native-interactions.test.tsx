// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Products, Refunds, BalancePaymentSource } from "../index.js";

afterEach(cleanup);
it("lets a package consumer create a recurring product price without example providers", async () => {
  const createPrice = vi.fn(async () => null);
  render(
    <Products
      scopeKey="store"
      products={[
        {
          stripeProductId: "prod_tee",
          name: "Tee club",
          active: true,
          prices: [],
        },
      ]}
      createProduct={async () => null}
      createPrice={createPrice}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add price" }));
  await userEvent.type(screen.getByLabelText("Price in minor units"), "2900");
  await userEvent.selectOptions(screen.getByLabelText("Interval"), "month");
  await userEvent.click(screen.getByRole("button", { name: "Create price" }));
  await waitFor(() =>
    expect(createPrice).toHaveBeenCalledWith({
      stripeProductId: "prod_tee",
      unitAmount: 2900,
      currency: "usd",
      type: "recurring",
      interval: "month",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText("Price in minor units")).toBeNull(),
  );
});
it("submits a partial refund through the native UI and renders its receipt", async () => {
  const issueRefund = vi.fn(async () => ({ stripeRefundId: "re_partial" }));
  render(<Refunds scopeKey="store" issueRefund={issueRefund} />);
  await userEvent.type(screen.getByLabelText("PaymentIntent ID"), "pi_one");
  await userEvent.type(screen.getByLabelText("Partial refund amount"), "12.34");
  await userEvent.click(screen.getByRole("button", { name: "Partial refund" }));
  await waitFor(() =>
    expect(issueRefund).toHaveBeenCalledWith({
      stripePaymentIntentId: "pi_one",
      amountCents: 1234,
      reason: "requested_by_customer",
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "Refund created: re_partial",
  );
});
it("requires explicit consent before the native balance-funding UI can submit", async () => {
  const change = vi.fn(async () => null);
  render(
    <BalancePaymentSource scopeKey="store" enabled={false} change={change} />,
  );
  const confirm = screen.getByRole("button", {
    name: "Confirm balance payments",
  });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(confirm);
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith({ enabled: true, consent: true }),
  );
});
