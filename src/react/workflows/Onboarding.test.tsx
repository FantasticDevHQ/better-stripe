// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOnboarding } from "./Onboarding.js";
afterEach(cleanup);
it("creates an account for the selected country and exposes a hosted link failure", async () => {
  const createAccount = vi
    .fn()
    .mockResolvedValue({ onboardingUrl: "https://connect.stripe.com/setup" });
  const continueOnboarding = vi
    .fn()
    .mockRejectedValue(new Error("Account restricted"));
  const navigate = vi.fn();
  const { result } = renderHook(() =>
    useOnboarding({
      scopeKey: "seller",
      createAccount,
      continueOnboarding,
      onNavigate: navigate,
    }),
  );
  act(() => result.current.setSelectedCountry("GB"));
  await act(async () => {
    await result.current.create();
  });
  expect(createAccount).toHaveBeenCalledWith("GB");
  expect(navigate).toHaveBeenCalledWith("https://connect.stripe.com/setup");
  await act(async () => {
    await result.current.continue();
  });
  expect(result.current.linkError).toBe("Account restricted");
});

it("keeps onboarding link failures associated with the active operation", async () => {
  let fail!: (error: Error) => void;
  const createAccount = vi.fn();
  const { result } = renderHook(() =>
    useOnboarding({
      scopeKey: "seller",
      createAccount,
      continueOnboarding: () =>
        new Promise<{ url: string }>((_, reject) => {
          fail = reject;
        }),
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.continue();
  });
  await act(async () => {
    await result.current.create();
  });
  expect(result.current.isLinking).toBe(true);
  expect(createAccount).not.toHaveBeenCalled();
  await act(async () => {
    fail(new Error("Link unavailable"));
    await pending;
  });
  expect(result.current.linkError).toBe("Link unavailable");
  expect(result.current.createError).toBeNull();
});
it("offers the shared example countries in the native onboarding UI", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { Onboarding } = await import("./Onboarding.js");
  render(
    <Onboarding
      scopeKey="store"
      account={null}
      createAccount={async () => ({})}
      continueOnboarding={async () => ({})}
    />,
  );
  expect(screen.getByRole("option", { name: "United Kingdom" })).toBeTruthy();
});
