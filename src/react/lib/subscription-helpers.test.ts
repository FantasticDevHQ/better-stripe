import { describe, expect, it } from "vitest";

import {
  daysUntil,
  deriveSubscriptionState,
  getSubscriptionStatusLabel,
} from "./subscription-helpers.js";

describe("daysUntil", () => {
  it("returns 0 for null/undefined", () => {
    expect(daysUntil(null)).toBe(0);
    expect(daysUntil(undefined)).toBe(0);
  });

  it("returns 0 for past dates", () => {
    expect(daysUntil("2020-01-01T00:00:00Z")).toBe(0);
  });

  it("returns positive number for future dates", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(daysUntil(future.toISOString())).toBeGreaterThanOrEqual(9);
    expect(daysUntil(future.toISOString())).toBeLessThanOrEqual(11);
  });
});

describe("deriveSubscriptionState", () => {
  it("active subscription", () => {
    const state = deriveSubscriptionState({
      status: "active",
      isTrialing: false,
      cancelAtPeriodEnd: false,
    });
    expect(state.isActive).toBe(true);
    expect(state.isTrialing).toBe(false);
    expect(state.isCanceling).toBe(false);
    expect(state.isCanceled).toBe(false);
    expect(state.isPastDue).toBe(false);
  });

  it("trialing subscription", () => {
    const future = new Date();
    future.setDate(future.getDate() + 7);
    const state = deriveSubscriptionState({
      status: "trialing",
      isTrialing: true,
      trialEnd: future.toISOString(),
      cancelAtPeriodEnd: false,
    });
    expect(state.isActive).toBe(true);
    expect(state.isTrialing).toBe(true);
    expect(state.daysUntilTrialEnd).toBeGreaterThanOrEqual(6);
  });

  it("canceling subscription (cancel at period end)", () => {
    const state = deriveSubscriptionState({
      status: "active",
      isTrialing: false,
      cancelAtPeriodEnd: true,
    });
    expect(state.isActive).toBe(true);
    expect(state.isCanceling).toBe(true);
    expect(state.isCanceled).toBe(false);
  });

  it("canceled subscription", () => {
    const state = deriveSubscriptionState({
      status: "canceled",
      isTrialing: false,
      cancelAtPeriodEnd: false,
      canceledAt: "2024-01-01T00:00:00Z",
    });
    expect(state.isActive).toBe(false);
    expect(state.isCanceled).toBe(true);
    expect(state.isCanceling).toBe(false);
  });

  it("past due subscription", () => {
    const state = deriveSubscriptionState({
      status: "past_due",
      isTrialing: false,
      cancelAtPeriodEnd: false,
    });
    expect(state.isActive).toBe(false);
    expect(state.isPastDue).toBe(true);
  });

  it("daysUntilTrialEnd is 0 when not trialing", () => {
    const state = deriveSubscriptionState({
      status: "active",
      isTrialing: false,
      cancelAtPeriodEnd: false,
    });
    expect(state.daysUntilTrialEnd).toBe(0);
  });
});

describe("getSubscriptionStatusLabel", () => {
  it("returns default labels", () => {
    expect(getSubscriptionStatusLabel("active")).toBe("Active");
    expect(getSubscriptionStatusLabel("trialing")).toBe("Trial");
    expect(getSubscriptionStatusLabel("past_due")).toBe("Past Due");
    expect(getSubscriptionStatusLabel("canceled")).toBe("Canceled");
    expect(getSubscriptionStatusLabel("incomplete")).toBe("Incomplete");
    expect(getSubscriptionStatusLabel("incomplete_expired")).toBe("Expired");
    expect(getSubscriptionStatusLabel("unpaid")).toBe("Unpaid");
    expect(getSubscriptionStatusLabel("paused")).toBe("Paused");
  });

  it("returns raw status for unknown values", () => {
    expect(getSubscriptionStatusLabel("some_new_status")).toBe(
      "some_new_status",
    );
  });

  it("allows label overrides", () => {
    expect(getSubscriptionStatusLabel("active", { active: "Subscribed" })).toBe(
      "Subscribed",
    );
  });

  it("override takes precedence over default", () => {
    expect(getSubscriptionStatusLabel("canceled", { canceled: "Ended" })).toBe(
      "Ended",
    );
  });
});
