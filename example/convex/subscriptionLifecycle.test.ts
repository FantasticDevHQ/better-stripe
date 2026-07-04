// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

import { lifecycleArgs, trialEndFromDateInput } from "./subscriptionLifecycle";

describe("subscriptionLifecycle — buyer subscription action contracts (BTS-81)", () => {
  it("requires user ownership context for every subscription lifecycle action", () => {
    const args = lifecycleArgs({
      userId: "user_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(args).toEqual({
      userId: "user_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("rejects missing ownership context before a Stripe side effect", () => {
    expect(() =>
      lifecycleArgs({
        userId: "",
        stripeSubscriptionId: "sub_123",
      }),
    ).toThrow("userId is required");
  });

  it("rejects missing subscription ids before a Stripe side effect", () => {
    expect(() =>
      lifecycleArgs({
        userId: "user_123",
        stripeSubscriptionId: "",
      }),
    ).toThrow("stripeSubscriptionId is required");
  });

  it("converts a date input to Stripe's Unix-seconds trial_end value", () => {
    expect(trialEndFromDateInput("2030-01-01")).toBe(1893456000);
  });

  it("keeps the now sentinel for immediate trial ending", () => {
    expect(trialEndFromDateInput("now")).toBe("now");
  });

  it("rejects invalid trial-end date input", () => {
    expect(() => trialEndFromDateInput("not-a-date")).toThrow(
      "Trial end must be a valid date or now",
    );
  });
});
