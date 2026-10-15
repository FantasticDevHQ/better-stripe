"use client";
import type { EarningsTransfer } from "./useEarnings.js";
import type { StripeComponentPayout } from "../types.js";
export type CurrencyEarningsTotal = {
  currency: string;
  gross: number;
  reversed: number;
  net: number;
  transferCount: number;
};
export type CurrencyPayoutTotal = {
  currency: string;
  paidOut: number;
  payoutCount: number;
};
export type AccountCurrencyEarnings = {
  totals: CurrencyEarningsTotal[];
  transfers: EarningsTransfer[];
};
export type AccountCurrencyPayouts = {
  totals: CurrencyPayoutTotal[];
  payouts: StripeComponentPayout[];
};
export type UseCurrencyEarningsResult = {
  totals: (CurrencyEarningsTotal & CurrencyPayoutTotal)[];
  transfers: EarningsTransfer[];
  payouts: StripeComponentPayout[];
  isLoading: boolean;
};
/** Bind authorized host queries to the maintained component currency summaries. */
export function createUseCurrencyEarnings(
  useQuery: (ref: any, args: Record<string, unknown> | "skip") => any,
  earningsRef: any,
  payoutsRef: any,
) {
  return function useCurrencyEarnings(
    accountId: string | undefined,
  ): UseCurrencyEarningsResult {
    const earnings = useQuery(
      earningsRef,
      accountId ? { destinationAccountId: accountId } : "skip",
    ) as AccountCurrencyEarnings | undefined;
    const payouts = useQuery(payoutsRef, accountId ? { accountId } : "skip") as
      AccountCurrencyPayouts | undefined;
    const byCurrency = new Map<
      string,
      CurrencyEarningsTotal & CurrencyPayoutTotal
    >();
    for (const row of earnings?.totals ?? [])
      byCurrency.set(row.currency, { ...row, paidOut: 0, payoutCount: 0 });
    for (const row of payouts?.totals ?? [])
      byCurrency.set(row.currency, {
        ...(byCurrency.get(row.currency) ?? {
          currency: row.currency,
          gross: 0,
          reversed: 0,
          net: 0,
          transferCount: 0,
        }),
        ...row,
      });
    return {
      totals: [...byCurrency.values()].sort((a, b) =>
        a.currency.localeCompare(b.currency),
      ),
      transfers: earnings?.transfers ?? [],
      payouts: payouts?.payouts ?? [],
      isLoading:
        accountId !== undefined &&
        (earnings === undefined || payouts === undefined),
    };
  };
}
