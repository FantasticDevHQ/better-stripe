// @vitest-environment edge-runtime
/**
 * Tests for createRefund's fee/transfer flags (BTS-34). The refund params sent
 * to Stripe are the whole contract here: `refund_application_fee` and
 * `reverse_transfer` default ON but are only sent when the charge actually
 * carries an application fee / a destination transfer — sending either flag on
 * an incapable charge is a hard Stripe error, which would break refunds of
 * plain (non-marketplace) charges. Pro-rata sizing for partial refunds is
 * Stripe-native for both flags, so the client only decides presence.
 */
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import { createRefund } from "./refunds.js";

const ctx = {} as RunCtx;

function makeStripe(charge: Record<string, unknown>) {
  return {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_new" }),
    },
    charges: {
      retrieve: vi.fn().mockResolvedValue({ id: "ch_1", ...charge }),
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

    const result = await createRefund(asStripe(stripe), ctx, {
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

    await createRefund(asStripe(stripe), ctx, {
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

    await createRefund(asStripe(stripe), ctx, { stripeChargeId: "ch_1" });

    const params = stripe.refunds.create.mock.calls[0][0];
    expect("refund_application_fee" in params).toBe(false);
    expect("reverse_transfer" in params).toBe(false);
  });

  it("omits reverse_transfer for a separate-charges (split) sale charge", async () => {
    // Split-sale charges carry no transfer_data — the webhook clawback owns
    // the transfer math there.
    const stripe = makeStripe({ transfer: null, application_fee: null });

    await createRefund(asStripe(stripe), ctx, { stripeChargeId: "ch_1" });

    expect("reverse_transfer" in stripe.refunds.create.mock.calls[0][0]).toBe(
      false,
    );
  });

  it("honours an explicit false even when the charge is capable", async () => {
    const stripe = makeStripe({ transfer: "tr_auto", application_fee: "fee_1" });

    await createRefund(asStripe(stripe), ctx, {
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

    await createRefund(asStripe(stripe), ctx, {
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

    await createRefund(asStripe(stripe), ctx, {
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
    await expect(createRefund(asStripe(stripe), ctx, {})).rejects.toThrow();
    await expect(
      createRefund(asStripe(stripe), ctx, {
        stripeChargeId: "ch_1",
        stripePaymentIntentId: "pi_1",
      }),
    ).rejects.toThrow();
  });
});
