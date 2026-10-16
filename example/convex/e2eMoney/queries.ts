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

import { query } from "../_generated/server";

import { connectQueries } from "./helpers";

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

/**
 * The persisted dispute rows for a charge's PaymentIntent (BTS-73). Lets the
 * harness tell "the dispute never landed" (async timing → legitimate SKIP) from
 * "the dispute landed but the clawback didn't reverse the transfers" (broken
 * wiring → hard FAIL).
 */
export const listDisputesForPaymentIntent = query({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) =>
    ctx.runQuery(connectQueries.listDisputes, {
      stripePaymentIntentId: args.stripePaymentIntentId,
    }),
});
