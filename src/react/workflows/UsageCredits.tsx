"use client";
import type { ReactNode } from "react";
import type { UsageAvailability } from "../../client/usage/boundaries.js";
import type {
  UsageCreditBalance,
  UsageCreditPurchase,
} from "../../client/usage/creditTerms.js";
import type { UsageCreditReconciliation } from "../../client/usage/creditObservation.js";
import { formatUsageEstimate } from "./usage-format.js";
export type UsageCreditsProps = {
  balance: UsageAvailability<UsageCreditBalance> | undefined;
  purchase?: UsageCreditPurchase | null;
  currency?: string;
  application?: UsageAvailability<UsageCreditReconciliation>;
  className?: string;
  children?: (
    state: Omit<UsageCreditsProps, "children" | "className">,
  ) => ReactNode;
};
export function UsageCredits({
  balance,
  purchase,
  currency,
  application,
  children,
  className,
}: UsageCreditsProps) {
  if (children)
    return <>{children({ balance, purchase, application, currency })}</>;
  return (
    <section
      data-better-stripe="usage-credits"
      className={className}
      aria-label="Prepaid credits"
      aria-busy={balance === undefined}
    >
      <h2>Prepaid credits</h2>
      {!balance ? (
        <p role="status">Loading credit balance…</p>
      ) : balance.status !== "available" ? (
        <p role="status">
          Credit balance {balance.status}. Verified backing is required.
        </p>
      ) : (
        <>
          <dl>
            {(
              [
                ["Available", balance.value.availableQuantity],
                ["Reserved", balance.value.reservedQuantity],
                ["Consumed", balance.value.consumedQuantity],
                ["Expired", balance.value.expiredQuantity],
                ["Frozen", balance.value.frozenQuantity],
              ] as const
            ).map(([label, quantity]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {quantity} {balance.value.unit}
                </dd>
              </div>
            ))}
          </dl>
          {(balance.value.status === "held" ||
            !/^0(?:\.0+)?$/.test(balance.value.frozenQuantity)) && (
            <p role="status">Credits held. Reconciliation is required.</p>
          )}
          {/^0(?:\.0+)?$/.test(balance.value.availableQuantity) && (
            <p role="status">
              Insufficient credits for new work. A server reservation must
              authorize consumption.
            </p>
          )}
        </>
      )}
      {purchase && (
        <p role="status">
          {
            {
              pending: "Payment pending. No units granted yet.",
              ready: "Payment verified and original credit grant retained.",
              frozen: "Purchase frozen. Recovery is required.",
              canceled: "Purchase canceled.",
            }[purchase.state]
          }{" "}
          Purchase {purchase.purchaseId}: {purchase.quantity} units for{" "}
          {formatUsageEstimate(String(purchase.amount), purchase.currency) ??
            "unavailable amount"}
          .
        </p>
      )}
      {application &&
        (application.status === "available" ? (
          <p role="status">
            Credit application {application.value.backing}.{" "}
            {application.value.reason
              ? "Reconciliation is required."
              : `Pending finalization amount: ${formatUsageEstimate(String(application.value.pendingFinalizationAmount), currency ?? (balance?.status === "available" ? balance.value.currency : purchase?.currency) ?? "") ?? "unavailable"}.`}
          </p>
        ) : (
          <p role="status">
            Credit application {application.status}. Original invoice evidence
            is not yet verified.
          </p>
        ))}
      <p>
        No cash is collected by consuming credits. This balance is not
        withdrawable money.
      </p>
    </section>
  );
}
