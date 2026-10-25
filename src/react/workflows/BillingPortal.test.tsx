// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BillingPortal, type BillingPortalProps } from "./Billing.js";
afterEach(cleanup);
type PortalState = Parameters<NonNullable<BillingPortalProps["children"]>>[0];

it.each(["scope", "unmount"])(
  "does not navigate after a pending portal's %s changes",
  async (change) => {
    let release!: (url: string) => void;
    const createSession = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const onNavigate = vi.fn();
    let state!: PortalState;
    const child = (value: PortalState) => {
      state = value;
      return null;
    };
    const view = render(
      <BillingPortal
        scopeKey="actor-a:sub-a:target-a"
        createSession={createSession}
        onNavigate={onNavigate}
      >
        {child}
      </BillingPortal>,
    );
    let pending!: Promise<true | undefined>;
    act(() => {
      pending = state.open();
    });
    expect(createSession).toHaveBeenCalledOnce();
    if (change === "scope")
      view.rerender(
        <BillingPortal
          scopeKey="actor-b:sub-b:target-a"
          createSession={createSession}
          onNavigate={onNavigate}
        >
          {child}
        </BillingPortal>,
      );
    else view.unmount();
    await act(async () => {
      release("https://billing.stripe.test/old");
      expect(await pending).toBeUndefined();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  },
);

it("navigates once on current success and preserves the true return contract", async () => {
  const onNavigate = vi.fn();
  let state!: PortalState;
  render(
    <BillingPortal
      scopeKey="actor:original:target"
      createSession={async () => ({
        url: "https://billing.stripe.test/current",
      })}
      onNavigate={onNavigate}
    >
      {(value) => {
        state = value;
        return null;
      }}
    </BillingPortal>,
  );
  await act(async () => {
    expect(await state.open()).toBe(true);
  });
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
    "https://billing.stripe.test/current",
  );
});

it("keeps provider failure visible without navigating or fabricating success", async () => {
  const onNavigate = vi.fn();
  render(
    <BillingPortal
      scopeKey="actor:original:target"
      createSession={async () => {
        throw new Error("Confirmation unavailable");
      }}
      onNavigate={onNavigate}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open Stripe Billing Portal" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Confirmation unavailable",
  );
  expect(onNavigate).not.toHaveBeenCalled();
});
