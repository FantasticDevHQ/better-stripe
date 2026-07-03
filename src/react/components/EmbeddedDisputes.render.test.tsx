/**
 * Behavioral render tests for the embedded Connect dispute wrapper (BTS-55):
 * <ConnectProvider> + <EmbeddedDisputes>.
 *
 * ConnectJS embedded components are client-only iframes, so the two Stripe
 * packages are mocked (per the project's no-jsdom strategy) and the tests
 * assert what IS testable statically: initialization wiring (publishableKey +
 * fetchClientSecret handed to loadConnectAndInitialize verbatim and NOT called
 * during render — the Connect runtime calls it lazily), the provider/component
 * tree rendering without throwing via react-dom/server, the disputes_list vs
 * payment_disputes mount switch, and the headless overrides.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConnectAndInitialize = vi.fn(
  (_initParams: Record<string, unknown>) => ({
    update: vi.fn(),
    logout: vi.fn(),
  }),
);

vi.mock("@stripe/connect-js", () => ({
  loadConnectAndInitialize: (initParams: unknown) =>
    loadConnectAndInitialize(initParams as Record<string, unknown>),
}));

vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({
    connectInstance,
    children,
  }: {
    connectInstance: unknown;
    children?: unknown;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "connect-provider",
        "data-has-instance": String(Boolean(connectInstance)),
      },
      children as never,
    ),
  ConnectDisputesList: () =>
    createElement("div", { "data-testid": "disputes-list" }),
  ConnectPaymentDisputes: ({ payment }: { payment: string }) =>
    createElement("div", {
      "data-testid": "payment-disputes",
      "data-payment": payment,
    }),
}));

import { ConnectProvider } from "./ConnectProvider.js";
import { EmbeddedDisputes } from "./EmbeddedDisputes.js";

describe("ConnectProvider", () => {
  beforeEach(() => {
    loadConnectAndInitialize.mockClear();
  });

  it("initializes Connect with the publishable key and the account-session fetcher, uncalled at render", () => {
    const fetchClientSecret = vi.fn().mockResolvedValue("acs_secret_123");

    const html = renderToStaticMarkup(
      createElement(
        ConnectProvider,
        { publishableKey: "pk_test_123", fetchClientSecret },
        createElement("span", null, "child"),
      ),
    );

    expect(loadConnectAndInitialize).toHaveBeenCalledTimes(1);
    const initParams = loadConnectAndInitialize.mock.calls[0][0];
    expect(initParams.publishableKey).toBe("pk_test_123");
    // The EXACT fetcher reference is handed over — the Connect runtime calls
    // it to obtain the createDisputeSession clientSecret; render must not.
    expect(initParams.fetchClientSecret).toBe(fetchClientSecret);
    expect(fetchClientSecret).not.toHaveBeenCalled();
    // Provider rendered with an instance, children inside.
    expect(html).toContain('data-testid="connect-provider"');
    expect(html).toContain('data-has-instance="true"');
    expect(html).toContain("child");
  });

  it("forwards appearance options to loadConnectAndInitialize", () => {
    renderToStaticMarkup(
      createElement(
        ConnectProvider,
        {
          publishableKey: "pk_test_123",
          fetchClientSecret: () => Promise.resolve("acs_x"),
          appearance: { overlays: "dialog" },
        },
        createElement("span"),
      ),
    );

    const initParams = loadConnectAndInitialize.mock.calls[0][0];
    expect(initParams.appearance).toEqual({ overlays: "dialog" });
  });
});

describe("EmbeddedDisputes", () => {
  const renderInProvider = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(
        ConnectProvider,
        {
          publishableKey: "pk_test_123",
          fetchClientSecret: () => Promise.resolve("acs_x"),
        },
        createElement(EmbeddedDisputes, props),
      ),
    );

  it("smoke: renders the provider + disputes_list embedded component without throwing", () => {
    const html = renderInProvider();
    expect(html).toContain('data-testid="connect-provider"');
    expect(html).toContain('data-testid="disputes-list"');
  });

  it("mounts payment_disputes scoped to one payment when `payment` is set", () => {
    const html = renderInProvider({ payment: "pi_123" });
    expect(html).toContain('data-testid="payment-disputes"');
    expect(html).toContain('data-payment="pi_123"');
    expect(html).not.toContain('data-testid="disputes-list"');
  });

  it("applies className to the wrapper element", () => {
    const html = renderInProvider({ className: "disputes-embed" });
    expect(html).toContain('class="disputes-embed"');
  });
});

describe("react barrel exports", () => {
  it("exports ConnectProvider and EmbeddedDisputes", async () => {
    const barrel = await import("../index.js");
    expect(barrel.ConnectProvider).toBe(ConnectProvider);
    expect(barrel.EmbeddedDisputes).toBe(EmbeddedDisputes);
  });
});
