import { describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import {
  buildDisputeEvidence,
  disputeEvidenceCountdown,
  updateDispute,
} from "./disputes.js";

function makeStripe() {
  return { disputes: { update: vi.fn().mockResolvedValue({}) } };
}
const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof updateDispute>[0];
const ctx = {} as RunCtx;

describe("buildDisputeEvidence (BTS-31)", () => {
  it("maps Skool-style categories to Stripe evidence fields", () => {
    expect(
      buildDisputeEvidence({
        productDescription: "Pro membership: weekly calls + course",
        accessActivity: "Member logged in 12 times; posted 4 times",
        additionalInfo: "Offered a refund, declined",
      }),
    ).toEqual({
      product_description: "Pro membership: weekly calls + course",
      access_activity_log: "Member logged in 12 times; posted 4 times",
      uncategorized_text: "Offered a refund, declined",
    });
  });

  it("omits unset categories", () => {
    expect(buildDisputeEvidence({ productDescription: "X" })).toEqual({
      product_description: "X",
    });
  });
});

describe("disputeEvidenceCountdown (BTS-31)", () => {
  it("computes days remaining before the deadline", () => {
    const r = disputeEvidenceCountdown(
      "2026-07-10T00:00:00.000Z",
      new Date("2026-07-01T00:00:00.000Z"),
    );
    expect(r.daysRemaining).toBe(9);
    expect(r.isOverdue).toBe(false);
  });

  it("flags an overdue deadline", () => {
    const r = disputeEvidenceCountdown(
      "2026-07-01T00:00:00.000Z",
      new Date("2026-07-05T00:00:00.000Z"),
    );
    expect(r.isOverdue).toBe(true);
    expect(r.daysRemaining).toBeLessThanOrEqual(0);
  });

  it("returns null countdown when there is no due date", () => {
    const r = disputeEvidenceCountdown(undefined, new Date());
    expect(r.dueBy).toBeUndefined();
    expect(r.daysRemaining).toBeUndefined();
    expect(r.isOverdue).toBe(false);
  });
});

describe("updateDispute staged vs submit (BTS-31)", () => {
  it("stages evidence without submitting", async () => {
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { product_description: "X" } },
      undefined,
    );
  });

  it("finalizes with submit: true and scopes to the seller account", async () => {
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
      submit: true,
      stripeAccountId: "acct_seller",
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { product_description: "X" }, submit: true },
      { stripeAccount: "acct_seller" },
    );
  });
});
