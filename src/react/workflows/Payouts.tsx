"use client";
import { useState, type ReactNode } from "react";
import { Connect, type ConnectProps } from "./Connect.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
import { formatPrice } from "../lib/price-helpers.js";
export type PayoutRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  /** Unix milliseconds. */ arrivalDate: number | null;
  created: number;
};
export type PayoutSnapshot = {
  balances: { currency: string; available: number; pending: number }[];
  payouts: PayoutRow[];
  upcoming: PayoutRow[];
  nextCursor: string | null;
};
export type PayoutsRenderProps = {
  data: PayoutSnapshot | undefined;
  error: string | null;
  isLoading: boolean;
  isPending: boolean;
  nextPayout: PayoutRow | undefined;
  previousPayouts: PayoutRow[];
  refresh: () => void;
  loadMore: () => Promise<void>;
};
export type HeadlessPayoutsProps = {
  presentation?: "headless";
  scopeKey: string;
  load: (cursor?: string) => Promise<PayoutSnapshot>;
  children?: (state: PayoutsRenderProps) => ReactNode;
};
export type PayoutsProps =
  | HeadlessPayoutsProps
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
const upcoming = (row: PayoutRow) =>
  row.status === "pending" || row.status === "in_transit";
export function Payouts(props: PayoutsProps) {
  return props.presentation === "embedded" ? (
    <Connect {...props} component="payouts" />
  ) : (
    <PayoutsBody key={props.scopeKey} {...props} />
  );
}
function PayoutsBody({ load, scopeKey, children }: HeadlessPayoutsProps) {
  const resource = useWorkflowResource(() => load(), scopeKey);
  const more = useWorkflowAction(
    (cursor: string) => load(cursor),
    `${scopeKey}:${resource.revision}`,
  );
  const [pages, setPages] = useState<{
    base: PayoutSnapshot | undefined;
    rows: PayoutRow[];
    cursor: string | null | undefined;
  }>({ base: undefined, rows: [], cursor: undefined });
  if (pages.base !== resource.data)
    setPages({ base: resource.data, rows: [], cursor: undefined });
  const base = resource.data;
  const nextCursor =
    pages.cursor === undefined ? (base?.nextCursor ?? null) : pages.cursor;
  const data = base
    ? {
        ...base,
        nextCursor,
        payouts: [
          ...new Map(
            [...base.payouts, ...pages.rows].map((row) => [row.id, row]),
          ).values(),
        ],
      }
    : undefined;
  const loadMore = async () => {
    if (!nextCursor || resource.isLoading) return;
    const next = await more.run(nextCursor);
    if (next)
      setPages((previous) => ({
        ...previous,
        rows: [...previous.rows, ...next.payouts],
        cursor: next.nextCursor,
      }));
  };
  const sortedUpcoming =
    data?.upcoming
      .filter(upcoming)
      .slice()
      .sort(
        (a, b) => (a.arrivalDate ?? Infinity) - (b.arrivalDate ?? Infinity),
      ) ?? [];
  const state: PayoutsRenderProps = {
    data,
    isLoading: resource.isLoading,
    isPending: resource.isLoading || more.isPending,
    error: resource.error ?? more.error,
    nextPayout: sortedUpcoming[0],
    previousPayouts: data?.payouts.filter((row) => !upcoming(row)) ?? [],
    refresh: resource.refresh,
    loadMore,
  };
  return <>{children ? children(state) : <NativePayouts {...state} />}</>;
}
function date(value: number | null) {
  return value === null
    ? "Not supplied by Stripe"
    : new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" });
}
function PayoutTable({
  rows,
  emptyLabel,
}: {
  rows: PayoutRow[];
  emptyLabel: string;
}) {
  return rows.length ? (
    <table>
      <thead>
        <tr>
          <th>Payout ID</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Arrival date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.id}</td>
            <td>{formatPrice(row.amount, row.currency)}</td>
            <td>{row.status}</td>
            <td>{date(row.arrivalDate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>{emptyLabel}</p>
  );
}
function NativePayouts({
  data,
  isLoading,
  isPending,
  error,
  nextPayout,
  previousPayouts,
  refresh,
  loadMore,
}: PayoutsRenderProps) {
  return (
    <section data-better-stripe="payouts" aria-busy={isPending}>
      <h2>Payouts</h2>
      <button type="button" disabled={isPending} onClick={refresh}>
        {isPending ? "Refreshing…" : "Refresh"}
      </button>
      {error && <p role="alert">{error}</p>}
      {isLoading && !data && <p role="status">Loading payouts…</p>}
      {data && (
        <>
          <dl>
            {data.balances.map((balance) => (
              <div key={balance.currency}>
                <dt>Available</dt>
                <dd>{formatPrice(balance.available, balance.currency)}</dd>
                <dt>Pending</dt>
                <dd>{formatPrice(balance.pending, balance.currency)}</dd>
              </div>
            ))}
            <dt>Next payout</dt>
            <dd>
              {nextPayout
                ? `${formatPrice(nextPayout.amount, nextPayout.currency)} · ${date(nextPayout.arrivalDate)}`
                : "Not scheduled"}
            </dd>
          </dl>
          <h3>Upcoming payouts</h3>
          <PayoutTable
            rows={data.upcoming}
            emptyLabel="No upcoming payouts scheduled."
          />
          <h3>Previous payouts</h3>
          <PayoutTable
            rows={previousPayouts}
            emptyLabel="No previous payouts yet."
          />
          {data.nextCursor && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                void loadMore();
              }}
            >
              {isPending ? "Loading…" : "Load more payouts"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
