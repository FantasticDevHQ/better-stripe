// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlanBilling } from "./BillingPlans.js";
afterEach(cleanup);
it("confirms a return session once and creates plan checkout only on explicit selection", async () => {
  const confirm = vi.fn().mockResolvedValue(null);
  const createCheckout = vi.fn().mockResolvedValue({
    stripeSessionId: "cs_plan",
    clientSecret: "cs_plan_secret",
  });
  const { result, rerender } = renderHook(
    ({ scope }) =>
      usePlanBilling({
        scopeKey: scope,
        sessionId: "cs_return",
        confirm,
        createCheckout,
        createPortal: async () => "https://billing.stripe.com/session",
      }),
    { initialProps: { scope: "seller_one" } },
  );
  await waitFor(() => expect(confirm).toHaveBeenCalledWith("cs_return"));
  expect(createCheckout).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.choose("growth");
  });
  expect(result.current.clientSecret).toBe("cs_plan_secret");
  rerender({ scope: "seller_two" });
  expect(result.current.clientSecret).toBeUndefined();
});
