/**
 * Money-scenario drivers + ledger reads for the e2e:webhooks release gate
 * (BTS-49).
 *
 * The webhook harness (`scripts/e2e-webhooks.ts`) proves events flow through the
 * pipeline; these functions let it prove the MONEY actually moves — a
 * destination charge collects an `application_fee`, a multi-recipient split
 * fans out one `Transfer` per recipient, and a refund/dispute reverses them.
 * All the driving happens through real Stripe API calls + the real webhook
 * engine; the harness then reads these queries to assert the persisted ledger.
 *
 * NOT unit-runnable end to end: the actions call live Stripe (test mode) and
 * depend on a linked dev deployment. Only the pure helpers are unit-tested
 * (`e2e-money.test.ts`); the actions/queries are typecheck- + lint-covered and
 * exercised by the pre-release `pnpm --filter ./example run e2e:webhooks` run.
 */
import { v } from "convex/values";
import Stripe from "stripe";

import { action, query } from "./_generated/server";
import { components } from "./_generated/api";
import { stripe } from "./stripe";

// Match the API version the BetterStripe client pins (see seed.ts).
type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;
const STRIPE_API_VERSION: StripeApiVersion = "2026-05-27.dahlia";

function rawStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set on the deployment");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

/**
 * The library's component exposes transfer/payment queries, but the installed
 * `ComponentApi` type is generated from a codegen snapshot that predates them
 * (the same gap BTS-43 flagged), so they are not statically typed on
 * `components.betterStripe`. They exist at runtime. One localized cast reaches
 * them for these read-only assertions; regenerating the component codegen is a
 * tracked follow-up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectQueries = (components.betterStripe as any).connect.queries;

// ─── Ledger reads (assertions target these) ──────────────────────────────

/** The persisted split legs for a sale's charge (reinstatement rows excluded). */
export const listTransfersForCharge = query({
  args: { sourceChargeId: v.string() },
  handler: async (ctx, args) =>
    ctx.runQuery(connectQueries.listTransfersByCharge, {
      sourceChargeId: args.sourceChargeId,
    }),
});

/** The persisted payment row (fee/routing denormalized from the webhook). */
export const getPaymentRow = query({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) =>
    ctx.runQuery(connectQueries.getPaymentByStripeId, {
      stripePaymentIntentId: args.stripePaymentIntentId,
    }),
});

// ─── Pure reconciliation helper (unit-tested) ────────────────────────────

/**
 * The headline invariant: a marketplace sale reconciles when the recipients'
 * cuts plus the platform's share equal the charge. Given the charge amount and
 * the recipient legs, the platform share is the remainder — non-negative and
 * exact — iff the sale reconciles.
 */
export function reconcilesToCharge(
  chargeAmount: number,
  recipientAmounts: number[],
): boolean {
  const recipientsTotal = recipientAmounts.reduce((sum, a) => sum + a, 0);
  const platform = chargeAmount - recipientsTotal;
  return platform >= 0 && recipientsTotal >= 0 && recipientsTotal <= chargeAmount;
}

// ─── Recipient activation (BTS-9/10 recipe) ──────────────────────────────

/**
 * Provision a transfer-ready V2 recipient (create + activate) so transfers to it
 * actually succeed — an un-onboarded destination fails with
 * `insufficient_capabilities_for_transfer`. This is the BTS-9/10 spike recipe,
 * recreated as reviewed code (the throwaway spike script was deleted):
 *
 *  1. create a `dashboard: "none"` account requesting the recipient's
 *     `stripe_transfers` capability (BTS-50: `express` accounts can't accept ToS
 *     via the API, so recipients must be `dashboard: none`), then
 *  2. attest identity + ToS so the test SSN (`000000000`) auto-verifies and the
 *     capability activates.
 *
 * Test-mode only. The exact V2 field paths track the pinned API version; they
 * are the spike's validated shape — re-verify against Stripe's V2 docs on the
 * first live run (the harness SKIPs, never falsely PASSES, if activation fails).
 */
export const provisionTestRecipient = action({
  args: { label: v.string(), businessUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    void ctx;
    const raw = rawStripe();
    // RFC3339 (not unix) ToS acceptance date — the recipe's classic sharp edge.
    const tosDate = new Date().toISOString();

    // The V2 identity/attestations/recipient-capability params outrun the SDK's
    // static types on some versions; the shape follows the validated spike.
    const createParams = {
      dashboard: "none",
      identity: { country: "US", entity_type: "individual" },
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const account = await raw.v2.core.accounts.create(createParams);

    const updateParams = {
      include: ["identity", "defaults", "configuration.recipient"],
      identity: {
        entity_type: "individual",
        individual: {
          given_name: "Testy",
          surname: args.label,
          date_of_birth: { day: 1, month: 1, year: 1990 },
          address: {
            line1: "354 Oyster Point Blvd",
            city: "South San Francisco",
            state: "CA",
            postal_code: "94080",
            country: "US",
          },
          id_numbers: [{ type: "us_ssn", value: "000000000" }],
        },
        attestations: {
          terms_of_service: { account: { date: tosDate, ip: "127.0.0.1" } },
        },
      },
      defaults: {
        profile: {
          business_url: args.businessUrl ?? "https://example.com/store",
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await raw.v2.core.accounts.update(account.id, updateParams);

    return { stripeAccountId: account.id };
  },
});

// ─── Scenario drivers ────────────────────────────────────────────────────

const DEMO_CURRENCY = "usd";

/**
 * A destination-charge sale with a platform fee (AC1). The webhook denormalizes
 * `applicationFeeAmount`/`feeCollectedAmount` + `destinationAccountId` onto the
 * payments row — the same fee path a destination-charge subscription's invoice
 * takes. Returns the ids the harness asserts against.
 */
export const e2eDestinationFeeSale = action({
  args: {
    storeAccountId: v.string(),
    amount: v.number(),
    applicationFeeAmount: v.number(),
  },
  handler: async (ctx, args) => {
    void ctx;
    const raw = rawStripe();
    const pi = await raw.paymentIntents.create({
      amount: args.amount,
      currency: DEMO_CURRENCY,
      confirm: true,
      payment_method: "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_data: { destination: args.storeAccountId },
      application_fee_amount: args.applicationFeeAmount,
      metadata: { e2e: "destination-fee" },
    });
    return {
      stripePaymentIntentId: pi.id,
      stripeChargeId:
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : (pi.latest_charge?.id ?? null),
    };
  },
});

/**
 * A multi-recipient split sale (AC2): a separate-charges PaymentIntent tagged
 * with `bsChargeType=separate` + `bsSplit`, so `payment_intent.succeeded` drives
 * the webhook split engine to create one Transfer per recipient. Optionally uses
 * the dispute test token so Stripe raises `charge.dispute.created` (clawback
 * reverses the transfers). Returns the ids the harness asserts against.
 */
export const e2eSplitSale = action({
  args: {
    storeAccountId: v.string(),
    affiliateAccountId: v.string(),
    amount: v.number(),
    storeAmount: v.number(),
    affiliateAmount: v.number(),
    dispute: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    void ctx;
    const raw = rawStripe();

    // The dispute path charges Stripe's dispute-triggering test token so a real
    // `charge.dispute.created` fires against THIS charge (not a synthetic one).
    let paymentMethod = "pm_card_visa";
    if (args.dispute) {
      const pm = await raw.paymentMethods.create({
        type: "card",
        card: { token: "tok_createDispute" },
      });
      paymentMethod = pm.id;
    }

    const split = [
      {
        destinationAccountId: args.storeAccountId,
        role: "store",
        amount: args.storeAmount,
      },
      {
        destinationAccountId: args.affiliateAccountId,
        role: "affiliate",
        amount: args.affiliateAmount,
      },
    ];

    const pi = await raw.paymentIntents.create({
      amount: args.amount,
      currency: DEMO_CURRENCY,
      confirm: true,
      payment_method: paymentMethod,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        e2e: args.dispute ? "split-dispute" : "split",
        bsChargeType: "separate",
        bsSplit: JSON.stringify(split),
      },
    });
    return {
      stripePaymentIntentId: pi.id,
      stripeChargeId:
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : (pi.latest_charge?.id ?? null),
    };
  },
});

/**
 * Refund a split charge and reverse its transfers (a deterministic companion to
 * the async dispute path — both exercise the `reverseTransfers` primitive). The
 * webhook records the reversal on the transfer rows.
 */
export const e2eRefundCharge = action({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) =>
    stripe.createRefund(ctx, {
      stripePaymentIntentId: args.stripePaymentIntentId,
      reverseTransfer: true,
      reason: "requested_by_customer",
    }),
});
