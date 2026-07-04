/**
 * Tests for the BTS-84 `currentSubscriptionFrom` fix — a re-subscribed buyer
 * has one canceled-at-period-end sub from their old subscription plus a new
 * active one, and the page must display the active sub rather than the stale
 * canceled one.
 */
import { describe, expect, it } from "vitest";

import { currentSubscriptionFrom } from "./current-subscription";

describe("currentSubscriptionFrom", () => {
  it("prefers a new active subscription over an old canceled-at-period-end one", () => {
    const subscriptions = [
      { status: "canceled", cancelAtPeriodEnd: true, id: "old" },
      { status: "active", cancelAtPeriodEnd: false, id: "new" },
    ];

    expect(currentSubscriptionFrom(subscriptions)?.id).toBe("new");
  });

  it("still prefers a cancel-scheduled subscription while it is active", () => {
    const subscriptions = [
      { status: "active", cancelAtPeriodEnd: true, id: "canceling" },
      { status: "past_due", cancelAtPeriodEnd: false, id: "other" },
    ];

    expect(currentSubscriptionFrom(subscriptions)?.id).toBe("canceling");
  });
});
