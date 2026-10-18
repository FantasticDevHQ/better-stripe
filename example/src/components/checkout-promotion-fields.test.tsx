import type { FormEvent } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const peer = vi.hoisted(() => ({
  id: "cs_a",
  total: 1000,
  discount: 0,
  apply: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@stripe/react-stripe-js/checkout", async (original) => ({
  ...(await original<typeof import("@stripe/react-stripe-js/checkout")>()),
  useCheckout: () => ({
    type: "success",
    checkout: {
      id: peer.id,
      currency: "usd",
      canConfirm: true,
      total: {
        subtotal: { minorUnitsAmount: 1000 },
        discount: { minorUnitsAmount: peer.discount },
        total: { minorUnitsAmount: peer.total },
      },
      applyPromotionCode: peer.apply,
      removePromotionCode: peer.remove,
      confirm: peer.confirm,
    },
  }),
}));
import { CheckoutPromotionFields } from "./checkout-promotion-fields";
const props = {
  email: "buyer@example.test",
  setEmail: vi.fn(),
  emailInputId: "buyer_email",
  isPending: false,
  error: null,
  paymentElement: <p>Secure payment details</p>,
  submit: vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault()),
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(peer, { id: "cs_a", total: 1000, discount: 0 });
  peer.apply.mockResolvedValue({ type: "success", session: { id: "cs_a" } });
  peer.remove.mockResolvedValue({ type: "success", session: { id: "cs_a" } });
});
it("uses public promotion actions and provider totals without replacing the original confirmation", async () => {
  const mounted = render(<CheckoutPromotionFields {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Promotion code" }), {
    target: { value: "WELCOME" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply code" }));
  await waitFor(() => expect(peer.apply).toHaveBeenCalledWith("WELCOME"));
  peer.discount = 1000;
  peer.total = 0;
  mounted.rerender(<CheckoutPromotionFields {...props} />);
  expect(screen.getByText("Current total: $0.00")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove code" }));
  await waitFor(() => expect(peer.remove).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(props.submit).toHaveBeenCalledOnce();
  expect(peer.confirm).not.toHaveBeenCalled();
});
it("blocks confirmation during promotion I/O and retains an invalid-code error", async () => {
  let complete: (value: unknown) => void = () => {};
  peer.apply.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<CheckoutPromotionFields {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Promotion code" }), {
    target: { value: "BAD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply code" }));
  expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
  await act(async () =>
    complete({
      type: "error",
      error: { code: "invalidCode", message: "Code expired" },
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Code expired");
  expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
});
it("clears an old session input and ignores its late provider error", async () => {
  let complete: (value: unknown) => void = () => {};
  peer.apply.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const mounted = render(<CheckoutPromotionFields {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Promotion code" }), {
    target: { value: "OLD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply code" }));
  peer.id = "cs_b";
  mounted.rerender(<CheckoutPromotionFields {...props} />);
  await act(async () =>
    complete({ type: "error", error: { message: "Old session error" } }),
  );
  expect(screen.getByRole("textbox", { name: "Promotion code" })).toHaveValue(
    "",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(props.submit).not.toHaveBeenCalled();
});
