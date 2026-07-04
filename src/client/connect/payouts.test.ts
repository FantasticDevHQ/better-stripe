// @vitest-environment edge-runtime
/**
 * Tests for getAccountBalance (BTS-65): a per-account balance read that wraps
 * `stripe.balance.retrieve` with `Stripe-Account` header scoping and pairs
 * Stripe's separate `available` / `pending` currency lists into one
 * `{ available, pending, currency }` entry per currency (minor units) — the
 * shape the headless `PayoutSchedule` component's `balance` prop consumes.
 */
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import { createPayout, getAccountBalance } from "./payouts.js";

/** A Stripe stub whose balance.retrieve resolves the given balance object. */
function makeStripe(balance: {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}) {
  return {
    balance: {
      retrieve: vi.fn().mockResolvedValue({ object: "balance", ...balance }),
    },
    payouts: {
      create: vi.fn().mockResolvedValue({ id: "po_1" }),
    },
  };
}
const asStripe = (s: ReturnType<typeof makeStripe>) => s as unknown as Stripe;
const noCtx = {} as RunCtx;

describe("getAccountBalance (BTS-65)", () => {
  it("scopes the balance read to the connected account via the Stripe-Account header", async () => {
    const stripe = makeStripe({
      available: [{ amount: 12550, currency: "usd" }],
      pending: [{ amount: 4300, currency: "usd" }],
    });

    await getAccountBalance(asStripe(stripe), {
      stripeAccountId: "acct_seller",
    });

    expect(stripe.balance.retrieve).toHaveBeenCalledWith(undefined, {
      stripeAccount: "acct_seller",
    });
  });

  it("pairs available and pending by currency into one entry per currency", async () => {
    const stripe = makeStripe({
      available: [{ amount: 12550, currency: "usd" }],
      pending: [{ amount: 4300, currency: "usd" }],
    });

    const balances = await getAccountBalance(asStripe(stripe), {
      stripeAccountId: "acct_seller",
    });

    expect(balances).toEqual([
      { available: 12550, pending: 4300, currency: "usd" },
    ]);
  });

  it("returns one entry per currency for a multi-currency account", async () => {
    const stripe = makeStripe({
      available: [
        { amount: 12550, currency: "usd" },
        { amount: 900, currency: "eur" },
      ],
      pending: [
        { amount: 4300, currency: "usd" },
        { amount: 100, currency: "eur" },
      ],
    });

    const balances = await getAccountBalance(asStripe(stripe), {
      stripeAccountId: "acct_seller",
    });

    expect(balances).toEqual([
      { available: 12550, pending: 4300, currency: "usd" },
      { available: 900, pending: 100, currency: "eur" },
    ]);
  });

  it("defaults the missing side to 0 when a currency appears in only one list", async () => {
    const stripe = makeStripe({
      available: [{ amount: 12550, currency: "usd" }],
      // Pending carries a currency that has no available funds yet.
      pending: [{ amount: 700, currency: "gbp" }],
    });

    const balances = await getAccountBalance(asStripe(stripe), {
      stripeAccountId: "acct_seller",
    });

    expect(balances).toEqual([
      { available: 12550, pending: 0, currency: "usd" },
      { available: 0, pending: 700, currency: "gbp" },
    ]);
  });

  it("returns an empty array for an account with no balance", async () => {
    const stripe = makeStripe({ available: [], pending: [] });

    const balances = await getAccountBalance(asStripe(stripe), {
      stripeAccountId: "acct_seller",
    });

    expect(balances).toEqual([]);
  });
});

describe("createPayout (BTS-100)", () => {
  it("passes the supplied idempotency key to the Stripe payout create call", async () => {
    const stripe = makeStripe({ available: [], pending: [] });

    await createPayout(asStripe(stripe), noCtx, {
      stripeAccountId: "acct_seller",
      amount: 12500,
      currency: "usd",
      idempotencyKey: "bs_payout_run_1",
    });

    expect(stripe.payouts.create).toHaveBeenCalledWith(
      { amount: 12500, currency: "usd", metadata: undefined },
      {
        stripeAccount: "acct_seller",
        idempotencyKey: "bs_payout_run_1",
      },
    );
  });
});
