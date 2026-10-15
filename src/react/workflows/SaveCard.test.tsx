// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const confirm = vi.hoisted(() => vi.fn());
vi.mock("../components/StripeProvider.js", () => ({
  StripeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: () => <div>Card details</div>,
}));
vi.mock("../hooks/useConfirmPayment.js", () => ({
  useConfirmPayment: () => ({
    confirmSetup: confirm,
    isReady: true,
    hasElements: true,
  }),
}));
import { SaveCard } from "./SaveCard.js";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("retries provisioning with the same logical request and requires explicit consent before confirmation", async () => {
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ setupIntentId: "seti_one", clientSecret: "secret" });
  const success = vi.fn();
  confirm.mockResolvedValue({ success: true });
  render(
    <SaveCard
      publishableKey="pk_test"
      scopeKey="buyer"
      requestId="save-one"
      returnUrl="https://app.test/cards"
      createSetupIntent={create}
      onSuccess={success}
    />,
  );
  await screen.findByText("offline");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Card details");
  expect(create.mock.calls).toEqual([
    [{ requestId: "save-one" }],
    [{ requestId: "save-one" }],
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(success).toHaveBeenCalledWith("seti_one"));
  expect(confirm).toHaveBeenCalledWith("https://app.test/cards", "always");
});
it("keeps failed authentication retryable and does not report completion", async () => {
  confirm
    .mockResolvedValueOnce({ success: false, error: "Authentication failed" })
    .mockResolvedValueOnce({ success: true });
  const success = vi.fn();
  render(
    <SaveCard
      publishableKey="pk_test"
      scopeKey="buyer"
      returnUrl="https://app.test/cards"
      createSetupIntent={async () => ({
        setupIntentId: "seti_one",
        clientSecret: "secret",
      })}
      onSuccess={success}
    />,
  );
  await screen.findByText("Card details");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  await screen.findByRole("alert");
  expect(success).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(success).toHaveBeenCalledOnce());
});
it("does not confirm the same completed setup twice", async () => {
  confirm.mockResolvedValue({ success: true });
  const success = vi.fn();
  render(
    <SaveCard
      publishableKey="pk_test"
      scopeKey="buyer"
      returnUrl="https://app.test/cards"
      createSetupIntent={async () => ({
        setupIntentId: "seti_one",
        clientSecret: "secret",
      })}
      onSuccess={success}
    />,
  );
  await screen.findByText("Card details");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(success).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(confirm).toHaveBeenCalledOnce();
});
