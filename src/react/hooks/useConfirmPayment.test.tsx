// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ confirmSetup: vi.fn(), submit: vi.fn() }));
vi.mock("@stripe/react-stripe-js", () => ({
  useStripe: () => ({ confirmSetup: f.confirmSetup }),
  useElements: () => ({ submit: f.submit }),
}));
import { useConfirmPayment } from "./useConfirmPayment.js";
it("submits Elements and confirms explicit redisplay permission only on succeeded setup", async () => {
  f.submit.mockResolvedValue({});
  f.confirmSetup.mockResolvedValue({ setupIntent: { status: "succeeded" } });
  const { result } = renderHook(useConfirmPayment);
  expect(
    await result.current.confirmSetup("https://app.test", "always"),
  ).toEqual({ success: true });
  expect(f.submit).toHaveBeenCalled();
  expect(f.confirmSetup).toHaveBeenCalledWith({
    elements: expect.anything(),
    confirmParams: {
      return_url: "https://app.test",
      payment_method_data: { allow_redisplay: "always" },
    },
    redirect: "if_required",
  });
});
it("does not turn processing or incomplete authentication into saved-card success", async () => {
  f.submit.mockResolvedValue({});
  f.confirmSetup.mockResolvedValue({
    setupIntent: { status: "requires_action" },
  });
  const { result } = renderHook(useConfirmPayment);
  expect(await result.current.confirmSetup()).toEqual({
    success: false,
    error: "Card setup is not complete.",
  });
});
it("reports validation errors before confirmation", async () => {
  f.confirmSetup.mockClear();
  f.submit.mockResolvedValue({ error: { message: "Invalid card" } });
  const { result } = renderHook(useConfirmPayment);
  expect(await result.current.confirmSetup()).toEqual({
    success: false,
    error: "Invalid card",
  });
  expect(f.confirmSetup).not.toHaveBeenCalled();
});
