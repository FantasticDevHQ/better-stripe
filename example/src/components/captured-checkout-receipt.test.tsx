import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ErrorBoundary } from "react-error-boundary";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { CheckoutStatusPage } from "../pages/checkout-status";
import { AppErrorFallback } from "./app-error-fallback";

type ReceiptContext = {
  actorId: string;
  accountId: string;
  sessionId: string;
};
type ReadyReceipt = {
  status: "ready";
  stripeSessionId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  customerAccountId: string;
  livemode: boolean;
  amount: number;
  currency: string;
};
type ReceiptResult = ReadyReceipt | { status: "unavailable" };
const contextName = "billing/capturedReceipt/queries:context";
const readName = "billing/capturedReceipt/actions:read";
const original = {
  actorId: "buyer_a",
  accountId: "acct_a",
  sessionId: "cs_original",
};
const hooks = vi.hoisted(() => ({
  context: undefined as ReceiptContext | null | undefined,
  contextError: null as Error | null,
  payment: undefined as
    | { status: string; amount: number; currency: string }
    | undefined,
  query: vi.fn(),
  actionReference: vi.fn(),
  read: vi.fn<(args: { stripeSessionId: string }) => Promise<ReceiptResult>>(),
}));

// The demo persona stays fixed while the authenticated context changes.
// It is navigation state, never the receipt's actor/account authority.
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentRole: "buyer",
    currentUser: { id: "demo_other_buyer", stripeAccountId: "acct_demo_other" },
  }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useAction: (reference: Parameters<typeof getFunctionName>[0]) => {
    hooks.actionReference(getFunctionName(reference));
    return hooks.read;
  },
  useQuery: (
    reference: Parameters<typeof getFunctionName>[0],
    args: { stripeSessionId?: string; stripePaymentIntentId?: string } | "skip",
  ) => {
    const name = getFunctionName(reference);
    hooks.query(name, args);
    if (args === "skip") return undefined;
    if (name === "billing/capturedReceipt/queries:context") {
      if (hooks.contextError) throw hooks.contextError;
      return hooks.context;
    }
    if (name === "connect/queries:getPaymentByStripeId") return hooks.payment;
    if (name === "billing/public/queries:getCheckoutSessionByStripeId") {
      // A cached complete Session must never substitute for captured evidence.
      return { status: "complete", mode: "payment", metadata: {} };
    }
    throw new Error(`Unexpected mounted receipt query: ${name}`);
  },
}));

function ready(
  context: ReceiptContext = original,
  amount = 3500,
  currency = "usd",
): ReadyReceipt {
  return {
    status: "ready",
    stripeSessionId: context.sessionId,
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    customerAccountId: context.accountId,
    livemode: false,
    amount,
    currency,
  };
}
function deferred() {
  let resolve!: (result: ReceiptResult) => void;
  const promise = new Promise<ReceiptResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(search = "?session_id=cs_original") {
  let navigate!: ReturnType<typeof useNavigate>;
  function Route() {
    navigate = useNavigate();
    return <CheckoutStatusPage />;
  }
  function tree() {
    return (
      <MemoryRouter initialEntries={[`/checkout-status${search}`]}>
        <ErrorBoundary FallbackComponent={AppErrorFallback}>
          <Route />
        </ErrorBoundary>
      </MemoryRouter>
    );
  }
  const view = render(tree());
  return {
    ...view,
    refresh: () => view.rerender(tree()),
    session: (sessionId: string) =>
      act(() => navigate(`/checkout-status?session_id=${sessionId}`)),
  };
}
function readReceipt() {
  fireEvent.click(screen.getByRole("button", { name: "Read payment receipt" }));
}
function expectNoCapture() {
  expect(screen.queryByText("Payment successful!")).not.toBeInTheDocument();
  expect(screen.queryByText("$35.00")).not.toBeInTheDocument();
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.context = { ...original };
  hooks.contextError = null;
  hooks.payment = undefined;
  hooks.read.mockReset();
});

it("reads only the authoritative Session and renders the real public PaymentReceipt", async () => {
  const pending = deferred();
  hooks.read.mockReturnValueOnce(pending.promise);
  mount();
  expectNoCapture();
  expect(hooks.read).not.toHaveBeenCalled();
  readReceipt();
  expectNoCapture();
  expect(hooks.query).toHaveBeenCalledWith(contextName, {
    stripeSessionId: original.sessionId,
  });
  expect(hooks.actionReference).toHaveBeenCalledWith(readName);
  expect(hooks.read).toHaveBeenCalledExactlyOnceWith({
    stripeSessionId: original.sessionId,
  });
  await act(async () => pending.resolve(ready()));
  expect(screen.getByText("Payment successful!")).toBeInTheDocument();
  expect(screen.getByText("Your purchase is confirmed by Stripe.")).toBeVisible();
  expect(screen.getByText("$35.00")).toBeVisible();
});

it("locks duplicate pending reads through the public SDK workflow", async () => {
  const pending = deferred();
  hooks.read.mockReturnValueOnce(pending.promise);
  mount();
  const button = screen.getByRole("button", { name: "Read payment receipt" });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(hooks.read).toHaveBeenCalledTimes(1);
  expectNoCapture();
  await act(async () => pending.resolve(ready()));
  expect(screen.getByText("$35.00")).toBeVisible();
});

const switches = [
  ["actor", { ...original, actorId: "buyer_b" }],
  ["account", { ...original, accountId: "acct_b" }],
  ["Session", { ...original, sessionId: "cs_next" }],
] as const;

it.each(switches)(
  "clears a completed receipt immediately when the authoritative %s changes",
  async (_label, next) => {
    hooks.read.mockResolvedValueOnce(ready());
    const view = mount();
    readReceipt();
    expect(await screen.findByText("$35.00")).toBeVisible();
    hooks.context = { ...next };
    if (next.sessionId !== original.sessionId) view.session(next.sessionId);
    else view.refresh();
    expectNoCapture();
    expect(hooks.read).toHaveBeenCalledTimes(1);
    hooks.read.mockResolvedValueOnce(ready(next, 2500, "jpy"));
    readReceipt();
    expect(await screen.findByText("¥2,500")).toBeVisible();
    expect(hooks.read).toHaveBeenLastCalledWith({
      stripeSessionId: next.sessionId,
    });
  },
);

it.each(switches)(
  "discards late A completion after a new authoritative %s has already completed",
  async (_label, next) => {
    const oldRequest = deferred();
    hooks.read.mockReturnValueOnce(oldRequest.promise);
    const view = mount();
    readReceipt();
    hooks.context = { ...next };
    if (next.sessionId !== original.sessionId) view.session(next.sessionId);
    else view.refresh();
    expectNoCapture();
    hooks.read.mockResolvedValueOnce(ready(next, 1234, "eur"));
    readReceipt();
    expect(await screen.findByText("€12.34")).toBeVisible();
    await act(async () => oldRequest.resolve(ready()));
    expect(screen.getByText("€12.34")).toBeVisible();
    expect(screen.queryByText("$35.00")).not.toBeInTheDocument();
    expect(hooks.read).toHaveBeenCalledTimes(2);
  },
);

it.each([undefined, null])(
  "drops a pending action while context is %s, even if the same actor later returns",
  async (context) => {
    const oldRequest = deferred();
    hooks.read.mockReturnValueOnce(oldRequest.promise);
    const view = mount();
    readReceipt();
    hooks.context = context;
    view.refresh();
    expectNoCapture();
    expect(
      screen.queryByRole("button", { name: "Read payment receipt" }),
    ).toBeNull();
    hooks.context = { ...original };
    view.refresh();
    await act(async () => oldRequest.resolve(ready()));
    expectNoCapture();
    expect(hooks.read).toHaveBeenCalledTimes(1);
  },
);

it.each([undefined, null])(
  "clears a completed receipt while authoritative context is %s",
  async (context) => {
    hooks.read.mockResolvedValueOnce(ready());
    const view = mount();
    readReceipt();
    expect(await screen.findByText("$35.00")).toBeVisible();
    hooks.context = context;
    view.refresh();
    expectNoCapture();
    expect(
      screen.queryByRole("button", { name: "Read payment receipt" }),
    ).toBeNull();
    expect(hooks.read).toHaveBeenCalledTimes(1);
  },
);

it("drops an existing receipt on query auth failure without exposing raw errors", async () => {
  hooks.read.mockResolvedValueOnce(ready());
  const view = mount();
  readReceipt();
  expect(await screen.findByText("$35.00")).toBeVisible();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    hooks.contextError = new Error("Authentication required private_token_secret");
    view.refresh();
    expect(screen.getByText("Something went wrong")).toBeVisible();
    expectNoCapture();
    expect(screen.queryByText(/private_token_secret/)).not.toBeInTheDocument();
    hooks.contextError = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expectNoCapture();
    expect(hooks.read).toHaveBeenCalledTimes(1);
  } finally {
    consoleError.mockRestore();
  }
});

it("offers a safe retry after action authentication failure", async () => {
  hooks.read.mockRejectedValueOnce(
    new Error("Authentication required private_secret"),
  );
  mount();
  readReceipt();
  expect(await screen.findByText("Payment receipt unavailable")).toBeVisible();
  expectNoCapture();
  expect(screen.queryByText(/private_secret/)).not.toBeInTheDocument();
  hooks.read.mockResolvedValueOnce(ready());
  fireEvent.click(screen.getByRole("button", { name: "Retry receipt" }));
  expect(await screen.findByText("$35.00")).toBeVisible();
  expect(hooks.read).toHaveBeenCalledTimes(2);
});

it("keeps unavailable evidence separate from the cached complete Session and retries", async () => {
  hooks.read.mockResolvedValueOnce({ status: "unavailable" });
  mount();
  readReceipt();
  expect(await screen.findByText("Payment receipt unavailable")).toBeVisible();
  expectNoCapture();
  hooks.read.mockResolvedValueOnce(ready());
  fireEvent.click(screen.getByRole("button", { name: "Retry receipt" }));
  expect(await screen.findByText("$35.00")).toBeVisible();
});

it("does not publish a pending receipt after navigation unmounts the page", async () => {
  const pending = deferred();
  hooks.read.mockReturnValueOnce(pending.promise);
  const view = mount();
  readReceipt();
  view.unmount();
  await act(async () => pending.resolve(ready()));
  expectNoCapture();
  expect(hooks.read).toHaveBeenCalledTimes(1);
});

it("preserves the existing PaymentIntent route's reactive public receipt", async () => {
  hooks.payment = { status: "processing", amount: 2900, currency: "usd" };
  const view = mount("?payment_intent=pi_legacy");
  expect(screen.getByText("Stripe payment status: processing")).toBeVisible();
  expect(screen.queryByText("Payment successful!")).not.toBeInTheDocument();
  expect(hooks.query).toHaveBeenCalledWith("connect/queries:getPaymentByStripeId", {
    stripePaymentIntentId: "pi_legacy",
  });
  hooks.payment = { ...hooks.payment, status: "succeeded" };
  view.refresh();
  await waitFor(() => expect(screen.getByText("$29.00")).toBeVisible());
  expect(screen.getByText("Payment successful!")).toBeInTheDocument();
  expect(hooks.read).not.toHaveBeenCalled();
});
