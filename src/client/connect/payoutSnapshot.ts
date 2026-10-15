import type Stripe from "stripe";
import { throwStripeError } from "../errors.js";
import { getAccountBalance, type AccountBalance } from "./payouts.js";
export type RecipientPayoutRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: number | null;
  created: number;
  failureCode?: string;
  failureMessage?: string;
};
export type RecipientPayoutSnapshot = {
  balances: AccountBalance[];
  payouts: RecipientPayoutRow[];
  upcoming: RecipientPayoutRow[];
  nextCursor: string | null;
  status: "ready" | "not_ready";
  reason?: string;
  upcomingComplete: boolean;
};
export type PayoutSnapshotOptions = {
  stripeAccountId: string;
  cursor?: string;
  limit?: number;
  maxUpcomingPages?: number;
};
const row = (p: Stripe.Payout): RecipientPayoutRow => ({
  id: p.id,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  arrivalDate: p.arrival_date ? p.arrival_date * 1000 : null,
  created: p.created * 1000,
  ...(p.failure_code != null ? { failureCode: p.failure_code } : {}),
  ...(p.failure_message != null ? { failureMessage: p.failure_message } : {}),
});
/** Account-scoped live balance and cursor history. Upcoming truncation is explicit. */
export async function getPayoutSnapshot(
  stripe: Stripe,
  opts: PayoutSnapshotOptions,
): Promise<RecipientPayoutSnapshot> {
  const limit = opts.limit ?? 100,
    maxPages = opts.maxUpcomingPages ?? 10;
  if (
    !opts.stripeAccountId ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Invalid payout account or page bounds.",
    );
  const options = { stripeAccount: opts.stripeAccountId };
  async function upcoming(status: "pending" | "in_transit") {
    const rows: Stripe.Payout[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const batch = await stripe.payouts.list(
        { status, limit: 100, starting_after: cursor },
        options,
      );
      rows.push(...batch.data);
      if (!batch.has_more) return { rows, complete: true };
      const next = batch.data[batch.data.length - 1]?.id;
      if (!next || next === cursor)
        throwStripeError(
          "STRIPE_API_ERROR",
          "Stripe payout pagination did not advance.",
        );
      cursor = next;
    }
    return { rows, complete: false };
  }
  try {
    const [balances, history, pending, transit] = await Promise.all([
      getAccountBalance(stripe, opts),
      stripe.payouts.list({ limit, starting_after: opts.cursor }, options),
      upcoming("pending"),
      upcoming("in_transit"),
    ]);
    const rows = [
      ...new Map(
        [...pending.rows, ...transit.rows]
          .filter((p) => p.status === "pending" || p.status === "in_transit")
          .map((p) => [p.id, row(p)]),
      ).values(),
    ].sort(
      (a, b) =>
        (a.arrivalDate ?? Infinity) - (b.arrivalDate ?? Infinity) ||
        a.created - b.created,
    );
    if (history.has_more && !history.data.length)
      throwStripeError(
        "STRIPE_API_ERROR",
        "Stripe payout history did not advance.",
      );
    return {
      status: "ready",
      balances,
      payouts: history.data.map(row),
      upcoming: rows,
      nextCursor: history.has_more
        ? history.data[history.data.length - 1]!.id
        : null,
      upcomingComplete: pending.complete && transit.complete,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["account_invalid", "resource_missing"].includes(String(error.code))
    )
      return {
        status: "not_ready",
        reason: "account_unavailable",
        balances: [],
        payouts: [],
        upcoming: [],
        nextCursor: null,
        upcomingComplete: true,
      };
    throwStripeError(
      "STRIPE_API_ERROR",
      "Could not retrieve recipient payout snapshot.",
    );
  }
}
