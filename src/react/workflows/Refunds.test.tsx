// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRefunds } from "./Refunds.js";
afterEach(cleanup);
it("validates a partial amount before Stripe and preserves exact minor units", async () => {
  const issueRefund = vi.fn().mockResolvedValue({ stripeRefundId: "re_test" });
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      issueRefund,
      paymentIntentId: " pi_test ",
    }),
  );
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).not.toHaveBeenCalled();
  expect(result.current.error).toContain("positive");
  act(() => result.current.setRefundAmount("12.34"));
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).toHaveBeenCalledWith({
    stripePaymentIntentId: "pi_test",
    amountCents: 1234,
    reason: "requested_by_customer",
  });
  expect(result.current.refundResult?.stripeRefundId).toBe("re_test");
});
it("rejects excess precision and resets fields for another account", async () => {
  const issueRefund = vi.fn();
  const { result, rerender } = renderHook(
    ({ scope }) =>
      useRefunds({ scopeKey: scope, issueRefund, paymentIntentId: "pi_test" }),
    { initialProps: { scope: "one" } },
  );
  act(() => result.current.setRefundAmount("0.005"));
  await act(async () => {
    await result.current.submitRefund("partial");
  });
  expect(issueRefund).not.toHaveBeenCalled();
  rerender({ scope: "two" });
  expect(result.current.refundAmount).toBe("");
  expect(result.current.refundResult).toBeNull();
});
it("keeps a pending refund labeled as a refund when a reversal is attempted", async () => {
  let finish!: (value: { stripeRefundId: string }) => void;
  const reverseTransfers = vi.fn();
  const { result } = renderHook(() =>
    useRefunds({
      scopeKey: "seller",
      paymentIntentId: "pi_one",
      sourceChargeId: "ch_one",
      issueRefund: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      reverseTransfers,
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.submitRefund("full");
  });
  await act(async () => {
    await result.current.submitReversal("full");
  });
  expect(result.current.busy).toBe("refund");
  expect(reverseTransfers).not.toHaveBeenCalled();
  await act(async () => {
    finish({ stripeRefundId: "re_one" });
    await pending;
  });
});
