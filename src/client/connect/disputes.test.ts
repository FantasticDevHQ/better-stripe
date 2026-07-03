import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  buildDisputeEvidence,
  disputeEvidenceCountdown,
  getDisputeWithCountdown,
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

  it("falls back cleanly (no NaN) for a malformed due date", () => {
    const r = disputeEvidenceCountdown("not-a-date", new Date());
    expect(r.daysRemaining).toBeUndefined();
    expect(r.isOverdue).toBe(false);
  });
});

describe("getDisputeWithCountdown (BTS-31)", () => {
  const TO_REF = Symbol.for("toReferencePath");
  const component = {
    connect: {
      queries: {
        getDisputeByStripeId: {
          [TO_REF]: "betterStripe/connect/queries/getDisputeByStripeId",
        },
      },
    },
  } as unknown as Component;

  it("returns the dispute with its evidence-due countdown attached", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      stripeDisputeId: "dp_1",
      status: "needs_response",
      evidenceDueBy: "2026-07-10T00:00:00.000Z",
    });
    const readCtx = { runQuery } as unknown as RunCtx;

    const result = await getDisputeWithCountdown(component, readCtx, {
      stripeDisputeId: "dp_1",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(result?.evidenceDueBy).toBe("2026-07-10T00:00:00.000Z");
    expect(result?.countdown).toEqual({
      dueBy: "2026-07-10T00:00:00.000Z",
      daysRemaining: 9,
      isOverdue: false,
    });
  });

  it("returns null when the dispute is not found", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const readCtx = { runQuery } as unknown as RunCtx;
    const result = await getDisputeWithCountdown(component, readCtx, {
      stripeDisputeId: "missing",
    });
    expect(result).toBeNull();
  });
});

describe("updateDispute staged vs submit (BTS-31, BTS-61, BTS-72)", () => {
  it("stages evidence safely by defaulting submit: false when submit is omitted", async () => {
    // BTS-61: Stripe's `submit` defaults to TRUE, so omitting it would submit
    // evidence to the bank (one-shot). Providing evidence without an explicit
    // submit must stage (submit: false), never silently submit.
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { product_description: "X" }, submit: false },
      undefined,
    );
  });

  it("passes an explicit submit: false through when staging", async () => {
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
      submit: false,
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { product_description: "X" }, submit: false },
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

  it("sends an explicit submit: false on a metadata-only update (BTS-72)", async () => {
    // BTS-72: a request that omits `submit` leans on Stripe's server-side
    // default — documented as TRUE on every update. Empirically (test mode,
    // 2026-07-03) a metadata-only update does NOT submit staged evidence, but
    // submission is one-shot and outcome-affecting, so the request must say
    // what it means instead of relying on behavior that contradicts the
    // documented default. No updateDispute call may ever implicitly submit.
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      metadata: { note: "internal" },
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { metadata: { note: "internal" }, submit: false },
      undefined,
    );
  });

  it("honours an explicit submit even with no evidence", async () => {
    const stripe = makeStripe();
    await updateDispute(asStripe(stripe), ctx, {
      stripeDisputeId: "dp_1",
      metadata: { note: "internal" },
      submit: true,
    });
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { metadata: { note: "internal" }, submit: true },
      undefined,
    );
  });
});
