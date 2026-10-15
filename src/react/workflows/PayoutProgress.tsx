"use client";
import { useMemo } from "react";
import {
  payoutProgressState,
  type PayoutProgressProps,
} from "./payout-progress-state.js";
export type {
  PayoutProgressMetric,
  PayoutProgressProps,
  PayoutProgressState,
} from "./payout-progress-state.js";
/** Unstyled, read-only progress. A preview never authorizes or requests a payout. */
export function PayoutProgress(props: PayoutProgressProps) {
  const { currency, locale = "en-US", timeZone, className, children } = props;
  const state = payoutProgressState(props);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }),
    [locale, timeZone],
  );
  if (children) return <>{children(state)}</>;
  const date = (value: number) => formatter.format(value);
  return (
    <section className={className} data-better-stripe="payout-progress">
      <h2>Automatic payout progress ({currency.toUpperCase()})</h2>
      <p role="status">{state.message}</p>
      <p>Stripe enforces its payout floor; a numeric amount is unavailable.</p>
      {state.recovery?.balances && (
        <div>
          <h3>Stripe balances at last expiry check</h3>
          <p>
            Provider balances are not a payable earnings assessment. Currencies
            remain separate.
          </p>
          <dl>
            {state.recovery.balances.map((balance) => (
              <div key={balance.currency}>
                <dt>{balance.currency.toUpperCase()} available</dt>
                <dd>{balance.availableLabel}</dd>
                <dt>{balance.currency.toUpperCase()} pending</dt>
                <dd>{balance.pendingLabel}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {state.progress && (
        <progress
          aria-label="Combined payout minimum"
          value={state.progress.value}
          max={state.progress.max}
        />
      )}
      {state.metrics.length > 0 && (
        <dl>
          {state.metrics.map((metric) => (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{metric.formattedValue}</dd>
            </div>
          ))}
        </dl>
      )}
      {state.sources.length > 0 && (
        <>
          <p>
            All categories contribute to one minimum. Source amounts are before
            shared costs and obligations. Pending funds do not qualify.
          </p>
          <table>
            <caption>Source contributions</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Mature unpaid</th>
                <th scope="col">Pending settlement</th>
                {state.accounting && <th scope="col">In flight</th>}
                {state.accounting && <th scope="col">Paid out</th>}
              </tr>
            </thead>
            <tbody>
              {state.sources.map((source) => (
                <tr key={source.role}>
                  <th scope="row">
                    {source.role === "store"
                      ? "Store"
                      : source.role === "affiliate"
                        ? "Affiliate"
                        : "Other"}
                  </th>
                  <td>{source.matureLabel}</td>
                  <td>{source.pendingLabel}</td>
                  {state.accounting && (
                    <td>{source.reservedLabel ?? "Not assessed"}</td>
                  )}
                  {state.accounting && (
                    <td>{source.releasedLabel ?? "Not assessed"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {state.accounting && (
        <p>
          Carried-forward funds remain owed. In-flight payouts are separate from
          completed payouts. Paid-out amounts exclude returned payouts.
        </p>
      )}
      {state.nextAttemptAt !== null && (
        <p>
          Next automatic attempt: {date(state.nextAttemptAt)}. This is not a
          bank arrival date.
        </p>
      )}
      {state.holdDeadline !== null && (
        <p>Custom holding deadline: {date(state.holdDeadline)}</p>
      )}
      {state.observedAt !== null && (
        <p>
          {state.recovery ? "Last recovery check" : "Assessed"}:{" "}
          {date(state.observedAt)}
        </p>
      )}
    </section>
  );
}
