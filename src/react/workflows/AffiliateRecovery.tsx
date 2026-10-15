"use client";
import type { ReactNode } from "react";
import type {
  AffiliateRecoverySnapshot,
  AffiliateRecoveryObligation,
  AffiliateRecoveryOperation,
} from "../../client/affiliateRecovery.js";
import { formatPrice } from "../lib/price-helpers.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type RecoveryMetric = {
  key: string;
  label: string;
  amount: number;
  formattedValue: string;
};
export type RecoveryAdjustment = {
  row: AffiliateRecoveryObligation;
  source: string;
  commission: string;
  recovered: string;
  debt: string;
  status: string;
};
export type AffiliateRecoveryView = {
  adjustments: RecoveryAdjustment[];
  metrics: RecoveryMetric[];
  rows: AffiliateRecoveryObligation[];
  currency: string;
  isLoading: boolean;
  isComplete: boolean;
  isPending: boolean;
  error: string | null;
  retry: (id: string) => Promise<unknown>;
};
export type AffiliateRecoveryProps = {
  snapshot: AffiliateRecoverySnapshot | undefined | null;
  currency: string;
  showMetrics?: boolean;
  locale?: string;
  className?: string;
  onRetry?: (obligationId: string) => Promise<unknown>;
  onInspect?: (obligationId: string) => void;
  sourceHref?: (row: AffiliateRecoveryObligation) => string | undefined;
  children?: (state: AffiliateRecoveryView) => ReactNode;
};
/** Reusable, unstyled recovery state for earnings, referred sales and payouts. */
export function AffiliateRecovery({
  snapshot,
  showMetrics = true,
  currency,
  locale,
  className,
  onRetry,
  onInspect,
  sourceHref,
  children,
}: AffiliateRecoveryProps) {
  const action = useWorkflowAction(
    async (id: string) => onRetry?.(id),
    `affiliate-recovery:${currency}`,
  );
  const balance = snapshot?.balance;
  if (
    (balance && balance.currency !== currency) ||
    snapshot?.obligations.page.some((row) => row.currency !== currency)
  )
    throw new Error("Affiliate recovery display cannot mix currencies.");
  const definitions = [
    ["originalCommission", "Original commission"],
    ["recoveredAmount", "Reversed"],
    ["outstandingDebt", "Outstanding debt"],
    ["offsetAmount", "Recovered from future earnings"],
    ["withheldAmount", "Withheld earnings"],
    ["reservedRecovery", "Pending recovery"],
    ["reservedRestoration", "Pending restoration"],
    ["restoredAmount", "Restored"],
    ["restorationDue", "Restoration owed"],
    ["netPayable", "Net payable"],
  ] as const;
  const metrics = definitions.map(([key, label]) => {
    const amount = balance?.[key] ?? 0;
    return {
      key,
      label,
      amount,
      formattedValue: formatPrice(amount, currency, locale),
    };
  });
  const adjustments = (snapshot?.obligations.page ?? []).map((row) => ({
    row,
    source: [
      row.sourceChargeId,
      row.storeAccountId,
      row.sourceInvoiceId,
      row.paymentId,
      row.lastRefundId,
      row.disputeId,
    ]
      .filter(Boolean)
      .join(" · "),
    commission: formatPrice(row.originalCommission, row.currency, locale),
    recovered: formatPrice(
      row.recoveredAmount + (row.offsetAmount ?? 0) - (row.restoredAmount ?? 0),
      row.currency,
      locale,
    ),
    debt: formatPrice(row.debtAmount ?? 0, row.currency, locale),
    status: row.needsReconciliation
      ? "Operator reconciliation required"
      : (row.lastState ?? "Settled"),
  }));
  const state: AffiliateRecoveryView = {
    adjustments,
    metrics,
    rows: snapshot?.obligations.page ?? [],
    currency,
    isLoading: snapshot === undefined,
    isComplete: snapshot?.obligations.isDone ?? false,
    isPending: action.isPending,
    error: action.error,
    retry: action.run,
  };
  if (children) return <>{children(state)}</>;
  return (
    <section className={className} data-better-stripe="affiliate-recovery">
      <h2>Commission recovery ({currency.toUpperCase()})</h2>
      {state.isLoading ? (
        <p role="status">Loading commission recovery…</p>
      ) : snapshot === null ? (
        <p>Sign in to view your commission recovery.</p>
      ) : (
        <>
          {showMetrics && (
            <dl>
              {metrics.map((metric) => (
                <div key={metric.key}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.formattedValue}</dd>
                </div>
              ))}
            </dl>
          )}
          {state.error && <p role="alert">{state.error}</p>}
          {!state.rows.length && <p>No commission adjustments yet.</p>}
          <table>
            <caption>Commission adjustments</caption>
            <thead>
              <tr>
                <th scope="col">Original sale</th>
                <th scope="col">Commission</th>
                <th scope="col">Recovered</th>
                <th scope="col">Debt</th>
                <th scope="col">State</th>
                {(onRetry || onInspect) && <th scope="col">Action</th>}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row._id}>
                  <td>
                    {sourceHref?.(row) ? (
                      <a href={sourceHref(row)}>{row.sourceChargeId}</a>
                    ) : (
                      row.sourceChargeId
                    )}
                    <br />
                    {[
                      row.storeAccountId,
                      row.sourceInvoiceId,
                      row.paymentId,
                      row.lastRefundId,
                      row.disputeId,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td>
                    {formatPrice(row.originalCommission, row.currency, locale)}
                  </td>
                  <td>
                    {formatPrice(
                      row.recoveredAmount +
                        (row.offsetAmount ?? 0) -
                        (row.restoredAmount ?? 0),
                      row.currency,
                      locale,
                    )}
                  </td>
                  <td>
                    {formatPrice(row.debtAmount ?? 0, row.currency, locale)}
                  </td>
                  <td>
                    {row.needsReconciliation
                      ? "Operator reconciliation required"
                      : (row.lastState ?? "Settled")}
                    {row.lastError && <p>{row.lastError}</p>}
                  </td>
                  {(onRetry || onInspect) && (
                    <td>
                      {onInspect && (
                        <button
                          type="button"
                          onClick={() => onInspect(row._id)}
                        >
                          Inspect attempts
                        </button>
                      )}
                      {onRetry && (
                        <button
                          type="button"
                          disabled={state.isPending}
                          onClick={() => {
                            void state.retry(row._id);
                          }}
                        >
                          Reconcile
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!state.isComplete && (
            <p>
              More adjustments are available. Totals include the complete
              account ledger.
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function AffiliateRecoveryHistory({
  operations,
  currency,
  locale,
}: {
  operations: AffiliateRecoveryOperation[];
  currency: string;
  locale?: string;
}) {
  return (
    <table data-better-stripe="affiliate-recovery-history">
      <caption>Recovery receipts and attempts</caption>
      <thead>
        <tr>
          <th scope="col">Operation</th>
          <th scope="col">Amount</th>
          <th scope="col">Outcome</th>
          <th scope="col">Receipt</th>
        </tr>
      </thead>
      <tbody>
        {operations.map((op) => (
          <tr key={op._id}>
            <td>
              {op.kind} · {op.sourceEventId ?? op._id}
            </td>
            <td>{formatPrice(op.amount, currency, locale)}</td>
            <td>
              {op.state}
              {op.error && <p>{op.error}</p>}
            </td>
            <td>{op.receiptId ?? "Unconfirmed"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
