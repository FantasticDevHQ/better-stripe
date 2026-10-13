// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("../components/ConnectProvider.js", () => ({
  ConnectProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@stripe/react-connect-js", () => {
  const Widget = ({
    onLoadError,
  }: {
    onLoadError: (event: { error: { message: string } }) => void;
  }) => (
    <button
      onClick={() =>
        onLoadError({ error: { message: "Account not eligible" } })
      }
    >
      Stripe widget
    </button>
  );
  return {
    ConnectAccountManagement: Widget,
    ConnectAccountOnboarding: Widget,
    ConnectBalances: Widget,
    ConnectDisputesList: Widget,
    ConnectNotificationBanner: Widget,
    ConnectPayments: Widget,
    ConnectPayouts: Widget,
  };
});
import { Connect } from "./Connect.js";
afterEach(cleanup);
it("exposes Stripe widget errors and remounts only on retry", async () => {
  render(
    <Connect
      component="payouts"
      scopeKey="acct_test"
      publishableKey="pk_test_example"
      fetchClientSecret={async () => "secret"}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Stripe widget" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "Account not eligible",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("button", { name: "Stripe widget" })).toBeTruthy();
});
