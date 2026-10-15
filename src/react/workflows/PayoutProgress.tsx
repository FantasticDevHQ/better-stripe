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
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
      {state.observedAt !== null && <p>Assessed: {date(state.observedAt)}</p>}
    </section>
  );
}
