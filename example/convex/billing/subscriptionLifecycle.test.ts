// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

import { trialEndFromDateInput } from "./subscriptionLifecycle";

// Ownership validation for subscription lifecycle actions (formerly this
// file's `lifecycleArgs`) now lives in the shared `assertSubscriptionOwner`
// gate (BTS-83) — see `authz.test.ts` and `actions.actions.test.ts`.
describe("subscriptionLifecycle — trial-end conversion (BTS-81)", () => {
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
