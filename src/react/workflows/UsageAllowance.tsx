"use client";
import type { ReactNode } from "react";
import type { UsageAvailability } from "../../client/usage/boundaries.js";
import type { UsageAllowanceStatus } from "../../client/usage/allowanceTerms.js";
import { allowanceProgress } from "./usage-format.js";
import { formatUsageEstimate } from "./usage-format.js";
export type UsageAllowanceProps = {
  allowance: UsageAvailability<UsageAllowanceStatus | null> | undefined;
  unit: string;
  className?: string;
  children?: (state: {
    allowance: UsageAllowanceProps["allowance"];
    unit: string;
  }) => ReactNode;
};
export function UsageAllowance({
  allowance,
  unit,
  className,
  children,
}: UsageAllowanceProps) {
  if (children) return <>{children({ allowance, unit })}</>;
  return (
    <section
      data-better-stripe="usage-allowance"
      className={className}
      aria-label="Usage allowance"
      aria-busy={allowance === undefined}
    >
      <h2>Usage allowance and limits</h2>
      {!allowance ? (
        <p role="status">Loading allowance…</p>
      ) : allowance.status !== "available" ? (
        <p role="status">
          Allowance {allowance.status}. Verified policy evidence is required.
        </p>
      ) : !allowance.value ? (
        <p>No allowance policy configured.</p>
      ) : (
        <>
          {allowanceProgress(allowance.value) !== null && (
            <progress
              aria-label="Included usage"
              max={10000}
              value={allowanceProgress(allowance.value)!}
              aria-valuetext={`${allowance.value.consumedQuantity} consumed and ${allowance.value.reservedQuantity} reserved of ${allowance.value.includedQuantity} ${unit} included`}
            />
          )}
          <dl>
            {(
              [
                ["Included", allowance.value.includedQuantity],
                ["Consumed", allowance.value.consumedQuantity],
                ["Reserved", allowance.value.reservedQuantity],
                [
                  "Remaining included",
                  allowance.value.remainingIncludedQuantity,
                ],
                ["Billable overage", allowance.value.billableOverageQuantity],
              ] as const
            ).map(([label, quantity]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {quantity} {unit}
                </dd>
              </div>
            ))}
          </dl>
          {allowance.value.policy.limit.mode !== "none" && (
            <p>
              {allowance.value.policy.limit.mode === "hard"
                ? "Hard limit"
                : "Soft threshold"}
              : {allowance.value.policy.limit.quantity} {unit}
            </p>
          )}
          {allowance.value.hardLimitRemainingQuantity !== null && (
            <p>
              Hard limit remaining: {allowance.value.hardLimitRemainingQuantity}{" "}
              {unit}
            </p>
          )}
          {allowance.value.softLimitReached && (
            <p role="status">Soft threshold reached. Usage may continue.</p>
          )}
          {!allowance.value.accepting && (
            <p role="status">
              New usage is not currently accepting reservations.
            </p>
          )}
          <p>
            Committed estimate:{" "}
            {formatUsageEstimate(
              allowance.value.committedEstimate.amountDecimal,
              allowance.value.committedEstimate.currency,
            ) ?? "Unavailable"}
          </p>
          <p>
            Including reservations:{" "}
            {formatUsageEstimate(
              allowance.value.projectedEstimate.amountDecimal,
              allowance.value.projectedEstimate.currency,
            ) ?? "Unavailable"}
          </p>
          <p>Resets at the verified billing-period boundary. No rollover.</p>
        </>
      )}
      <p>
        Display only. The server reservation enforces entitlement and limits.
      </p>
    </section>
  );
}
