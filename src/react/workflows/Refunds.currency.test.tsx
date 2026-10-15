// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Refunds, useRefunds } from "./Refunds.js";
afterEach(cleanup);
it.each([
  ["usd", "12.34", 1234],
  ["jpy", "500", 500],
  ["mga", "500", 500],
  ["isk", "500", 50000],
  ["ugx", "500", 50000],
  ["huf", "10.45", 1045],
  ["twd", "800.45", 80045],
  ["usd", "90071992547409.91", Number.MAX_SAFE_INTEGER],
])(
  "preserves original %s partial refund units",
  async (currency, input, expected) => {
    const issueRefund = vi
      .fn()
      .mockResolvedValue({ stripeRefundId: "re_test" });
    const { result } = renderHook(() =>
      useRefunds({
        scopeKey: "seller",
        paymentIntentId: "pi_test",
        paymentCurrency: currency,
        issueRefund,
      }),
    );
    act(() => result.current.setRefundAmount(input));
    await act(async () => {
      await result.current.submitRefund("partial");
    });
    expect(issueRefund).toHaveBeenCalledWith({
      stripePaymentIntentId: "pi_test",
      amountCents: expected,
      reason: "requested_by_customer",
    });
  },
);
it.each([
  ["jpy", "0.5"],
  ["mga", "1.5"],
  ["isk", "1.01"],
  ["ugx", "1.01"],
  ["usd", "0"],
  ["usd", "1.005"],
  ["usd", "1e2"],
  ["usd", "90071992547409.92"],
  ["ZZZ", "1"],
  ["bhd", "1"],
  [null, "1"],
])("blocks invalid original %s amount %s", async (currency, input) => {
  const issueRefund = vi.fn();
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_test",
      paymentCurrency: currency,
      issueRefund,
    }),
  );
  act(() => result.current.setRefundAmount(input));
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).not.toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});
it("uses independent original charge units for transfer reversal", async () => {
  const issueRefund = vi.fn().mockResolvedValue({ stripeRefundId: "re_test" });
  const reverseTransfers = vi.fn().mockResolvedValue({
    reversals: [],
    summary: { reversalCount: 0, totalReversed: 0 },
  });
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_test",
      paymentCurrency: "jpy",
      sourceChargeId: "ch_test",
      sourceChargeCurrency: "isk",
      issueRefund,
      reverseTransfers,
    }),
  );
  act(() => {
    result.current.setRefundAmount("500");
    result.current.setReversalAmount("500");
  });
  await act(async () => {
    await result.current.submitRefund("partial");
    await result.current.submitReversal("partial");
  });
  expect(issueRefund.mock.calls[0][0].amountCents).toBe(500);
  expect(reverseTransfers).toHaveBeenCalledWith({
    sourceChargeId: "ch_test",
    amountCents: 50000,
  });
});
it("omits amount for full operations even with unavailable currency", async () => {
  const issueRefund = vi.fn().mockResolvedValue({ stripeRefundId: "re_full" });
  const reverseTransfers = vi.fn().mockResolvedValue({
    reversals: [],
    summary: { reversalCount: 0, totalReversed: 0 },
  });
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_test",
      paymentCurrency: null,
      sourceChargeId: "ch_test",
      sourceChargeCurrency: null,
      issueRefund,
      reverseTransfers,
    }),
  );
  await act(async () => {
    await result.current.submitRefund("full");
    await result.current.submitReversal("full");
  });
  expect(
    Object.prototype.hasOwnProperty.call(
      issueRefund.mock.calls[0][0],
      "amountCents",
    ),
  ).toBe(false);
  expect(
    Object.prototype.hasOwnProperty.call(
      reverseTransfers.mock.calls[0][0],
      "amountCents",
    ),
  ).toBe(false);
});
it("does not apply a verified payment currency to another editable identifier", async () => {
  const issueRefund = vi.fn();
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_verified",
      paymentCurrency: "jpy",
      issueRefund,
    }),
  );
  act(() => {
    result.current.setPaymentIntentId("pi_other");
    result.current.setRefundAmount("500");
  });
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/currency|identifier/i);
});
it("requires an identified original payment when currency context is explicit", async () => {
  const issueRefund = vi.fn();
  const { result } = renderHook(() =>
    useRefunds({ scopeKey: "seller", paymentCurrency: "jpy", issueRefund }),
  );
  act(() => {
    result.current.setPaymentIntentId("pi_unverified");
    result.current.setRefundAmount("500");
  });
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).not.toHaveBeenCalled();
});
it("does not apply a verified charge currency to another reversal identifier", async () => {
  const reverseTransfers = vi.fn();
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      sourceChargeId: "ch_verified",
      sourceChargeCurrency: "jpy",
      issueRefund: vi.fn(),
      reverseTransfers,
    }),
  );
  act(() => {
    result.current.setSourceChargeId("ch_other");
    result.current.setReversalAmount("500");
  });
  await act(async () => {
    await result.current.submitReversal("partial");
  });
  expect(reverseTransfers).not.toHaveBeenCalled();
});
it("resets currency and payment scoped amounts/pending and ignores late completion", async () => {
  let finish: ((value: { stripeRefundId: string }) => void) | undefined;
  const issueRefund = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ stripeRefundId: "re_new" });
  const { result, rerender } = renderHook(
    ({ currency, id }) =>
      useRefunds({
        scopeKey: "seller",
        paymentIntentId: id,
        paymentCurrency: currency,
        issueRefund,
      }),
    { initialProps: { currency: "usd", id: "pi_one" } },
  );
  act(() => result.current.setRefundAmount("10.00"));
  let pending: Promise<unknown> | undefined;
  act(() => {
    pending = result.current.submitRefund("partial");
  });
  expect(result.current.isPending).toBe(true);
  rerender({ currency: "jpy", id: "pi_two" });
  expect(result.current.refundAmount).toBe("");
  expect(result.current.isPending).toBe(false);
  await act(async () => {
    finish?.({ stripeRefundId: "re_old" });
    await pending;
  });
  expect(result.current.refundResult).toBeNull();
  act(() => result.current.setRefundAmount("500"));
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).toHaveBeenLastCalledWith({
    stripePaymentIntentId: "pi_two",
    amountCents: 500,
    reason: "requested_by_customer",
  });
});
it("retains exact currency units through a retry", async () => {
  const issueRefund = vi
    .fn()
    .mockRejectedValueOnce(new Error("Retry"))
    .mockResolvedValue({ stripeRefundId: "re_retry" });
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_test",
      paymentCurrency: "jpy",
      issueRefund,
    }),
  );
  act(() => result.current.setRefundAmount("500"));
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(result.current.error).toBe("Retry");
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).toHaveBeenNthCalledWith(2, {
    stripePaymentIntentId: "pi_test",
    amountCents: 500,
    reason: "requested_by_customer",
  });
});
it("labels and validates native original-currency fields", async () => {
  const issueRefund = vi
    .fn()
    .mockResolvedValue({ stripeRefundId: "re_native" });
  render(
    <Refunds
      scopeKey="seller"
      paymentIntentId="pi_test"
      paymentCurrency="jpy"
      issueRefund={issueRefund}
    />,
  );
  const field = screen.getByLabelText("Partial refund amount (JPY)");
  expect(field).toHaveAttribute("step", "1");
  expect(field).toHaveAttribute("inputmode", "numeric");
  await userEvent.type(field, "500");
  await userEvent.click(screen.getByRole("button", { name: "Partial refund" }));
  expect(issueRefund).toHaveBeenCalledWith({
    stripePaymentIntentId: "pi_test",
    amountCents: 500,
    reason: "requested_by_customer",
  });
});
