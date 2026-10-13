// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const stripe = vi.hoisted(() => ({ initialize: vi.fn(), update: vi.fn() }));
vi.mock("@stripe/connect-js/pure.js", () => ({
  loadConnectAndInitialize: stripe.initialize,
}));
vi.mock("@stripe/connect-js", () => ({
  loadConnectAndInitialize: stripe.initialize,
}));
vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
import { ConnectProvider } from "./ConnectProvider.js";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("updates appearance and locale while retaining the active Connect session", async () => {
  stripe.initialize.mockReturnValue({ update: stripe.update });
  const first = vi.fn(async () => "first_session");
  const next = vi.fn(async () => "refreshed_session");
  const { rerender } = render(
    <ConnectProvider
      publishableKey="pk_test_one"
      fetchClientSecret={first}
      locale="en"
    />,
  );
  const fetch = stripe.initialize.mock.calls[0][0].fetchClientSecret;
  expect(await fetch()).toBe("first_session");
  rerender(
    <ConnectProvider
      publishableKey="pk_test_one"
      fetchClientSecret={next}
      locale="fr"
      appearance={{ variables: { colorPrimary: "#123456" } }}
    />,
  );
  expect(stripe.initialize).toHaveBeenCalledTimes(1);
  expect(stripe.update).toHaveBeenLastCalledWith({
    locale: "fr",
    appearance: { variables: { colorPrimary: "#123456" } },
  });
  expect(await fetch()).toBe("refreshed_session");
  expect(next).toHaveBeenCalledTimes(1);
});
it("creates a separate Connect instance when the publishable key changes", () => {
  stripe.initialize.mockReturnValue({ update: stripe.update });
  const fetch = async () => "session";
  const { rerender } = render(
    <ConnectProvider publishableKey="pk_test_one" fetchClientSecret={fetch} />,
  );
  rerender(
    <ConnectProvider publishableKey="pk_test_two" fetchClientSecret={fetch} />,
  );
  expect(stripe.initialize).toHaveBeenCalledTimes(2);
  expect(stripe.initialize.mock.calls[1][0].publishableKey).toBe("pk_test_two");
});
