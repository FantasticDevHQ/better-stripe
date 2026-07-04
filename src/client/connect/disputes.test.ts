import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  buildDisputeEvidence,
  closeDispute,
  disputeEvidenceCountdown,
  getDisputeWithCountdown,
  updateDispute,
} from "./disputes.js";

function makeStripe() {
  return {
    disputes: {
      update: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue({}),
    },
  };
}
const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof updateDispute>[0];
const ctx = {} as RunCtx;

const TO_REF = Symbol.for("toReferencePath");

/**
 * Component proxy exposing the two connect query refs the dispute-action
 * authorization resolves: the dispute (by its Stripe id) and the payment that
 * dispute is linked to (by PaymentIntent id).
 */
function makeAuthComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    connect: {
      queries: {
        getDisputeByStripeId: ref("connect/queries/getDisputeByStripeId"),
        getPaymentByStripeId: ref("connect/queries/getPaymentByStripeId"),
      },
    },
  } as unknown as Component;
}

/**
 * A ctx whose runQuery dispatches by the query args: a `stripeDisputeId` lookup
 * resolves the dispute row; a `stripePaymentIntentId` lookup resolves the
 * payment row. Either may be null to exercise the fail-closed paths.
 */
function makeAuthCtx(disputeRow?: unknown, paymentRow?: unknown) {
  const runQuery = vi.fn().mockImplementation((_ref, args) => {
    if (args && "stripeDisputeId" in args)
      return Promise.resolve(disputeRow ?? null);
    if (args && "stripePaymentIntentId" in args)
      return Promise.resolve(paymentRow ?? null);
    return Promise.resolve(null);
  });
  return { runQuery } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
  };
}

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
    await updateDispute(asStripe(stripe), makeAuthComponent(), ctx, {
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
    await updateDispute(asStripe(stripe), makeAuthComponent(), ctx, {
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
    await updateDispute(asStripe(stripe), makeAuthComponent(), ctx, {
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
    await updateDispute(asStripe(stripe), makeAuthComponent(), ctx, {
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
    await updateDispute(asStripe(stripe), makeAuthComponent(), ctx, {
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

describe("updateDispute — actor scoping (BTS-107)", () => {
  it("lets a platform admin update any dispute without a ledger lookup", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx();

    await updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
      actor: { type: "admin" },
    });

    // Admin short-circuits: no need to resolve the dispute's linked payment.
    expect(authCtx.runQuery).not.toHaveBeenCalled();
    expect(stripe.disputes.update).toHaveBeenCalledTimes(1);
  });

  it("lets a seller update a dispute for a sale routed to their own account", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      { stripePaymentIntentId: "pi_1", destinationAccountId: "acct_seller" },
    );

    await updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
      actor: { type: "seller", accountId: "acct_seller" },
    });

    // Dispute is resolved from the ledger to find its linked PaymentIntent...
    expect(authCtx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      stripeDisputeId: "dp_1",
    });
    // ...then the payment is resolved to check where the money was routed.
    expect(authCtx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      stripePaymentIntentId: "pi_1",
    });
    expect(stripe.disputes.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a seller updating a dispute for another seller's sale", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      { stripePaymentIntentId: "pi_1", destinationAccountId: "acct_other" },
    );

    await expect(
      updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_1",
        evidence: { product_description: "X" },
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor/i);

    // The unauthorized update never reaches Stripe.
    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });

  it("lets the store leg of a split sale act on its dispute (role threaded from the ledger)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      {
        stripePaymentIntentId: "pi_1",
        splitRecipients: [
          { destinationAccountId: "acct_store", role: "store" },
          { destinationAccountId: "acct_affiliate", role: "affiliate" },
        ],
      },
    );

    await updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
      actor: { type: "seller", accountId: "acct_store" },
    });

    expect(stripe.disputes.update).toHaveBeenCalledTimes(1);
  });

  it("rejects an affiliate leg acting on a split sale's dispute", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      {
        stripePaymentIntentId: "pi_1",
        splitRecipients: [
          { destinationAccountId: "acct_store", role: "store" },
          { destinationAccountId: "acct_affiliate", role: "affiliate" },
        ],
      },
    );

    await expect(
      updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_1",
        evidence: { product_description: "X" },
        actor: { type: "seller", accountId: "acct_affiliate" },
      }),
    ).rejects.toThrow(/not authorized|unauthor/i);

    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });

  it("preserves unrestricted behavior when actor is omitted (non-breaking)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx();

    await updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "X" },
    });

    // No actor → no ledger lookup, no gate: current behavior is preserved.
    expect(authCtx.runQuery).not.toHaveBeenCalled();
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { product_description: "X" }, submit: false },
      undefined,
    );
  });

  it("rejects a seller when the dispute isn't in the ledger (fail closed)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(null, null);

    await expect(
      updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_missing",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor|not found/i);

    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });

  it("rejects a seller when the dispute has no linked PaymentIntent (fail closed)", async () => {
    const stripe = makeStripe();
    // Dispute exists but carries no PaymentIntent (legacy charge-only): a seller
    // can't be verified against the payments ledger, so deny.
    const authCtx = makeAuthCtx({ stripeDisputeId: "dp_1" }, null);

    await expect(
      updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_1",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor/i);

    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });

  it("rejects a seller when the linked payment is missing (fail closed)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      null,
    );

    await expect(
      updateDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_1",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor|not found/i);

    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });
});

describe("closeDispute — actor scoping (BTS-107)", () => {
  it("lets a platform admin close any dispute without a ledger lookup", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx();

    await closeDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      actor: { type: "admin" },
    });

    expect(authCtx.runQuery).not.toHaveBeenCalled();
    expect(stripe.disputes.close).toHaveBeenCalledTimes(1);
  });

  it("lets a seller close a dispute for a sale routed to their own account", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      { stripePaymentIntentId: "pi_1", destinationAccountId: "acct_seller" },
    );

    await closeDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      actor: { type: "seller", accountId: "acct_seller" },
    });

    expect(stripe.disputes.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a seller closing a dispute for another seller's sale", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(
      { stripeDisputeId: "dp_1", stripePaymentIntentId: "pi_1" },
      { stripePaymentIntentId: "pi_1", destinationAccountId: "acct_other" },
    );

    await expect(
      closeDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_1",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor/i);

    // Conceding another seller's chargeback never reaches Stripe.
    expect(stripe.disputes.close).not.toHaveBeenCalled();
  });

  it("preserves unrestricted behavior when actor is omitted (non-breaking)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx();

    await closeDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
      stripeDisputeId: "dp_1",
      stripeAccountId: "acct_1",
    });

    expect(authCtx.runQuery).not.toHaveBeenCalled();
    expect(stripe.disputes.close).toHaveBeenCalledWith(
      "dp_1",
      {},
      { stripeAccount: "acct_1" },
    );
  });

  it("rejects a seller when the dispute isn't in the ledger (fail closed)", async () => {
    const stripe = makeStripe();
    const authCtx = makeAuthCtx(null, null);

    await expect(
      closeDispute(asStripe(stripe), makeAuthComponent(), authCtx, {
        stripeDisputeId: "dp_missing",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor|not found/i);

    expect(stripe.disputes.close).not.toHaveBeenCalled();
  });
});
