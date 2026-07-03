// @vitest-environment edge-runtime
/**
 * Tests for createRefund's fee/transfer flags (BTS-34) and actor scoping
 * (BTS-35). The refund params sent to Stripe are the whole contract for the
 * money math: `refund_application_fee` and `reverse_transfer` default ON but
 * are only sent when the charge actually carries an application fee / a
 * destination transfer — sending either flag on an incapable charge is a hard
 * Stripe error, which would break refunds of plain (non-marketplace) charges.
 * Pro-rata sizing for partial refunds is Stripe-native for both flags, so the
 * client only decides presence.
 *
 * Actor scoping (BTS-35) gates who may initiate a refund BEFORE any Stripe call:
 * a platform admin is unrestricted; a seller may refund only sales routed to
 * their own connected account, verified against the component's payments ledger.
 */
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { createRefund } from "./refunds.js";

const TO_REF = Symbol.for("toReferencePath");

/** Component proxy exposing the connect query refs createRefund resolves. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    connect: {
      queries: {
        getPaymentByStripeId: ref("connect/queries/getPaymentByStripeId"),
      },
    },
  } as unknown as Component;
}

/** A ctx whose runQuery resolves the given payment row (or null). */
function makeCtx(paymentRow?: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(paymentRow ?? null),
  } as unknown as RunCtx & { runQuery: ReturnType<typeof vi.fn> };
}

const noCtx = {} as RunCtx;

function makeStripe(charge: Record<string, unknown>) {
  return {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_new" }),
    },
    charges: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "ch_1", payment_intent: "pi_1", ...charge }),
    },
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" }),
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) => s as unknown as Stripe;

describe("createRefund — fee & transfer flags (BTS-34)", () => {
  it("defaults both flags on for a destination charge with an application fee", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });

    const result = await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
    });

    expect(result).toEqual({ stripeRefundId: "re_new" });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        charge: "ch_1",
        refund_application_fee: true,
        reverse_transfer: true,
      },
      undefined,
    );
  });

  it("keeps the flags on a partial refund (Stripe pro-rates both natively)", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
      amount: 2500,
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        refund_application_fee: true,
        reverse_transfer: true,
      }),
      undefined,
    );
  });

  it("omits both flags for a plain charge with no fee and no transfer", async () => {
    const stripe = makeStripe({ transfer: null, application_fee: null });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
    });

    const params = stripe.refunds.create.mock.calls[0][0];
    expect("refund_application_fee" in params).toBe(false);
    expect("reverse_transfer" in params).toBe(false);
  });

  it("omits reverse_transfer for a separate-charges (split) sale charge", async () => {
    // Split-sale charges carry no transfer_data — the webhook clawback owns
    // the transfer math there.
    const stripe = makeStripe({ transfer: null, application_fee: null });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
    });

    expect("reverse_transfer" in stripe.refunds.create.mock.calls[0][0]).toBe(
      false,
    );
  });

  it("honours an explicit false even when the charge is capable", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
      refundApplicationFee: false,
      reverseTransfer: false,
    });

    const params = stripe.refunds.create.mock.calls[0][0];
    expect("refund_application_fee" in params).toBe(false);
    expect("reverse_transfer" in params).toBe(false);
  });

  it("resolves the charge via the PaymentIntent when only a PI id is given", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: null });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripePaymentIntentId: "pi_1",
    });

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
      "pi_1",
      undefined,
      undefined,
    );
    expect(stripe.charges.retrieve).toHaveBeenCalledWith(
      "ch_1",
      undefined,
      undefined,
    );
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: "pi_1",
        reverse_transfer: true,
      },
      undefined,
    );
  });

  it("scopes the capability lookups and the refund to stripeAccountId", async () => {
    const stripe = makeStripe({ transfer: null, application_fee: "fee_1" });

    await createRefund(asStripe(stripe), makeComponent(), noCtx, {
      stripeChargeId: "ch_1",
      stripeAccountId: "acct_seller",
    });

    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1", undefined, {
      stripeAccount: "acct_seller",
    });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ refund_application_fee: true }),
      { stripeAccount: "acct_seller" },
    );
  });

  it("still rejects when neither or both charge identifiers are given", async () => {
    const stripe = makeStripe({});
    await expect(
      createRefund(asStripe(stripe), makeComponent(), noCtx, {}),
    ).rejects.toThrow();
    await expect(
      createRefund(asStripe(stripe), makeComponent(), noCtx, {
        stripeChargeId: "ch_1",
        stripePaymentIntentId: "pi_1",
      }),
    ).rejects.toThrow();
  });
});

describe("createRefund — actor scoping (BTS-35)", () => {
  it("lets a platform admin refund any sale without a ledger lookup", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });
    const ctx = makeCtx();

    await createRefund(asStripe(stripe), makeComponent(), ctx, {
      stripePaymentIntentId: "pi_1",
      actor: { type: "admin" },
    });

    // Admin short-circuits: no need to resolve the payment's routing.
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("lets a seller refund a destination charge routed to their own account", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: null });
    const ctx = makeCtx({
      stripePaymentIntentId: "pi_1",
      destinationAccountId: "acct_seller",
    });

    await createRefund(asStripe(stripe), makeComponent(), ctx, {
      stripePaymentIntentId: "pi_1",
      actor: { type: "seller", accountId: "acct_seller" },
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      expect.objectContaining({ [TO_REF]: expect.any(String) }),
      { stripePaymentIntentId: "pi_1" },
    );
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a seller refunding another seller's destination charge", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });
    const ctx = makeCtx({
      stripePaymentIntentId: "pi_1",
      destinationAccountId: "acct_other",
    });

    await expect(
      createRefund(asStripe(stripe), makeComponent(), ctx, {
        stripePaymentIntentId: "pi_1",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor/i);

    // The unauthorized refund never reaches Stripe.
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("lets a seller refund a split sale they are a recipient of", async () => {
    const stripe = makeStripe({ transfer: null, application_fee: null });
    const ctx = makeCtx({
      stripePaymentIntentId: "pi_1",
      splitRecipients: [
        { destinationAccountId: "acct_store" },
        { destinationAccountId: "acct_affiliate" },
      ],
    });

    await createRefund(asStripe(stripe), makeComponent(), ctx, {
      stripePaymentIntentId: "pi_1",
      actor: { type: "seller", accountId: "acct_store" },
    });

    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a seller when no matching payment exists in the ledger (fail closed)", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });
    const ctx = makeCtx(null);

    await expect(
      createRefund(asStripe(stripe), makeComponent(), ctx, {
        stripePaymentIntentId: "pi_unknown",
        actor: { type: "seller", accountId: "acct_seller" },
      }),
    ).rejects.toThrow(/not authorized|unauthor|not found/i);

    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("resolves a charge-only refund to its payment via the PaymentIntent for scoping", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: null });
    const ctx = makeCtx({
      stripePaymentIntentId: "pi_1",
      destinationAccountId: "acct_seller",
    });

    await createRefund(asStripe(stripe), makeComponent(), ctx, {
      stripeChargeId: "ch_1",
      actor: { type: "seller", accountId: "acct_seller" },
    });

    // Charge-only path resolves charge -> payment_intent -> ledger row.
    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      stripePaymentIntentId: "pi_1",
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});
