// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CheckoutSessionProvider,
  useCheckoutSession,
  useWorkflowAction,
} from "../index.js";

// Public provider and hook remain real; only the external Stripe peer is replaced.
const peer = vi.hoisted(() => ({
  id: "cs_original_custom",
  currency: "usd",
  subtotal: 1000,
  discount: 0,
  total: 1000,
  phase: "success",
  confirm: vi.fn(),
  apply: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@stripe/react-stripe-js/checkout", async (original) => ({
  ...(await original<typeof import("@stripe/react-stripe-js/checkout")>()),
  CheckoutElementsProvider: ({ children }: { children: ReactNode }) => children,
  useCheckout: () =>
    peer.phase === "loading"
      ? { type: "loading" }
      : peer.phase === "error"
        ? { type: "error", error: { message: "Session unavailable" } }
        : {
            type: "success",
            checkout: {
              id: peer.id,
              canConfirm: true,
              currency: peer.currency,
              total: {
                subtotal: { minorUnitsAmount: peer.subtotal },
                discount: { minorUnitsAmount: peer.discount },
                total: { minorUnitsAmount: peer.total },
              },
              confirm: peer.confirm,
              applyPromotionCode: peer.apply,
              removePromotionCode: peer.remove,
            },
          },
}));
const wrapper = ({ children }: { children: ReactNode }) => (
  <CheckoutSessionProvider
    publishableKey="pk_test_synthetic"
    clientSecret="cs_original_secret_synthetic"
  >
    {children}
  </CheckoutSessionProvider>
);
function useLoadedCheckout() {
  const checkout = useCheckoutSession();
  if (checkout.type !== "success")
    throw new Error("Fixture expected loaded checkout");
  return checkout;
}
function SavedMethodForm({
  beforeConfirm,
}: {
  beforeConfirm: () => Promise<void>;
}) {
  const state = useLoadedCheckout();
  return (
    <button
      onClick={async () => {
        await beforeConfirm();
        await state.confirm({ paymentMethod: "pm_selected" });
      }}
    >
      Confirm original saved card
    </button>
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(peer, {
    id: "cs_original_custom",
    currency: "usd",
    subtotal: 1000,
    discount: 0,
    total: 1000,
    phase: "success",
  });
  peer.confirm.mockResolvedValue({ type: "success" });
  peer.apply.mockResolvedValue({ type: "success", session: { id: peer.id } });
  peer.remove.mockResolvedValue({ type: "success", session: { id: peer.id } });
});
it("retains public custom saved-card confirmation after the host pre-confirmation step", async () => {
  const order: string[] = [];
  peer.confirm.mockImplementation(async () => {
    order.push("confirm");
    return { type: "success" };
  });
  const beforeConfirm = vi.fn(async () => {
    order.push("name update");
  });
  const Form = SavedMethodForm;
  render(<Form beforeConfirm={beforeConfirm} />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm original saved card" }),
  );
  await waitFor(() =>
    expect(peer.confirm).toHaveBeenCalledWith({ paymentMethod: "pm_selected" }),
  );
  expect(order).toEqual(["name update", "confirm"]);
  expect(peer.apply).not.toHaveBeenCalled();
  expect(peer.remove).not.toHaveBeenCalled();
});
it("exposes a public apply action on the existing custom session", () => {
  expect(
    renderHook(useLoadedCheckout, { wrapper }).result.current,
  ).toHaveProperty("applyPromotionCode", expect.any(Function));
});
it("exposes a public remove action on the same custom session", () => {
  expect(
    renderHook(useLoadedCheckout, { wrapper }).result.current,
  ).toHaveProperty("removePromotionCode", expect.any(Function));
});
it("delegates exact promotion input once and reads updated totals only from current provider observation", async () => {
  const hook = renderHook(useLoadedCheckout, { wrapper });
  expect(hook.result.current.pricing).toEqual({
    currency: "usd",
    subtotal: 1000,
    discount: 0,
    total: 1000,
  });
  expect(await hook.result.current.applyPromotionCode("WELCOME")).toEqual({
    type: "success",
    sessionId: peer.id,
  });
  expect(peer.apply).toHaveBeenCalledExactlyOnceWith("WELCOME");
  expect(hook.result.current.pricing?.total).toBe(1000);
  peer.discount = 200;
  peer.total = 800;
  hook.rerender();
  expect(hook.result.current.pricing).toEqual({
    currency: "usd",
    subtotal: 1000,
    discount: 200,
    total: 800,
  });
  expect(peer.confirm).not.toHaveBeenCalled();
  expect(await hook.result.current.removePromotionCode()).toEqual({
    type: "success",
    sessionId: peer.id,
  });
  expect(peer.remove).toHaveBeenCalledExactlyOnceWith();
  peer.discount = 0;
  peer.total = 1000;
  hook.rerender();
  expect(hook.result.current.pricing?.discount).toBe(0);
});
it.each(["invalid", "expired"])(
  "returns %s provider failure without changing totals or confirming",
  async (kind) => {
    peer.apply.mockResolvedValue({
      type: "error",
      error: { code: "invalidCode", message: `${kind} promotion` },
    });
    const { result } = renderHook(useLoadedCheckout, { wrapper });
    expect(await result.current.applyPromotionCode("BAD")).toEqual({
      type: "error",
      code: "invalidCode",
      message: `${kind} promotion`,
    });
    expect(result.current.pricing?.total).toBe(1000);
    expect(peer.confirm).not.toHaveBeenCalled();
  },
);
it.each(["apply", "remove"])(
  "keeps thrown %s transport failure unconfirmed",
  async (method) => {
    const action = method === "apply" ? peer.apply : peer.remove;
    action.mockRejectedValue(new Error("Transport unavailable"));
    const { result } = renderHook(useLoadedCheckout, { wrapper });
    const response =
      method === "apply"
        ? await result.current.applyPromotionCode("WELCOME")
        : await result.current.removePromotionCode();
    expect(response).toEqual({
      type: "error",
      message: "Promotion code update failed",
    });
    expect(peer.confirm).not.toHaveBeenCalled();
    expect(result.current.pricing?.total).toBe(1000);
  },
);
it.each([
  undefined,
  null,
  {},
  { type: "success" },
  { type: "unexpected" },
  { type: "error", error: {} },
])("rejects malformed or unknown promotion result %j", async (value) => {
  peer.apply.mockResolvedValue(value);
  const { result } = renderHook(useLoadedCheckout, { wrapper });
  expect(await result.current.applyPromotionCode("WELCOME")).toEqual({
    type: "error",
    message: "Promotion code update failed",
  });
  expect(peer.confirm).not.toHaveBeenCalled();
});
it("rejects a successful response for a different provider session", async () => {
  peer.remove.mockResolvedValue({
    type: "success",
    session: { id: "cs_foreign" },
  });
  const { result } = renderHook(useLoadedCheckout, { wrapper });
  expect(await result.current.removePromotionCode()).toEqual({
    type: "error",
    message: "Promotion code update failed",
  });
});
it.each([
  { currency: "jpy", subtotal: 500, discount: 500, total: 0 },
  { currency: "kwd", subtotal: 1250, discount: 250, total: 1000 },
])(
  "preserves provider minor units for $currency and zero totals",
  (pricing) => {
    Object.assign(peer, pricing);
    expect(
      renderHook(useLoadedCheckout, { wrapper }).result.current.pricing,
    ).toEqual(pricing);
  },
);
it("does not publish malformed monetary observation as a usable price", () => {
  peer.total = NaN;
  expect(
    renderHook(useLoadedCheckout, { wrapper }).result.current.pricing,
  ).toBeNull();
});
it.each(["loading", "error"])("retains the public %s state", (phase) => {
  peer.phase = phase;
  expect(renderHook(useCheckoutSession, { wrapper }).result.current).toEqual(
    phase === "loading"
      ? { type: "loading" }
      : { type: "error", message: "Session unavailable" },
  );
});
it.each(["replace", "unmount"])(
  "disposes a late A result after %s through the existing host workflow scope",
  async (mode) => {
    let complete: (value: unknown) => void = () => {};
    peer.apply.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const onSuccess = vi.fn();
    const hook = renderHook(
      () => {
        const checkout = useLoadedCheckout();
        return {
          checkout,
          action: useWorkflowAction(
            () => checkout.applyPromotionCode("WELCOME"),
            checkout.sessionId,
            onSuccess,
          ),
        };
      },
      { wrapper },
    );
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = hook.result.current.action.run();
    });
    if (mode === "replace") {
      peer.id = "cs_replacement";
      peer.total = 700;
      hook.rerender();
    } else hook.unmount();
    await act(async () => {
      complete({ type: "success", session: { id: "cs_original_custom" } });
      await pending;
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(peer.confirm).not.toHaveBeenCalled();
    if (mode === "replace") {
      expect(hook.result.current.checkout.pricing?.total).toBe(700);
      expect(hook.result.current.action.result).toBeUndefined();
    }
  },
);
