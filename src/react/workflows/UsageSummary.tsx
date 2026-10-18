"use client";
import { usageSummaryMatches } from "./usage-scope.js";
import type { ReactNode } from "react";
import type { UsageAvailability } from "../../client/usage/boundaries.js";
import type { UsageLocalSummary } from "../../client/usage/summary.js";
import type { UsageAggregateObservation } from "../../client/usage/observationTypes.js";
import type { UsageViewScope } from "./Usage.types.js";
import { formatUsageEstimate, formatUsageTime } from "./usage-format.js";
export type UsageSummaryProps = {
  scope: UsageViewScope;
  summary: UsageAvailability<UsageLocalSummary> | undefined;
  provider?: UsageAggregateObservation;
  className?: string;
  children?: (state: {
    summary: UsageSummaryProps["summary"];
    provider: UsageSummaryProps["provider"];
    isLoading: boolean;
    isEmpty: boolean;
  }) => ReactNode;
};
const models = {
  pay_as_you_go: "Pay as you go",
  included_overage: "Included monthly usage with overages",
  prepaid: "Prepaid credits",
};
const deliveryLabels = {
  queued: "Queued delivery",
  sending: "Sending delivery",
  provider_accepted: "Provider accepted",
  rejected: "Rejected delivery",
  unknown: "Unknown delivery",
  held: "Held delivery",
  canceled: "Canceled usage",
};
export function UsageSummary(props: UsageSummaryProps) {
  const provider =
    props.provider?.status === "available" &&
    (props.provider.value.period.start !== props.scope.period.start ||
      props.provider.value.period.end !== props.scope.period.end)
      ? {
          status: "unavailable" as const,
          reason: "observation_scope_mismatch",
          retryable: true,
        }
      : props.provider;
  const summary =
    props.summary?.status === "available" &&
    !usageSummaryMatches(props.scope, props.summary.value)
      ? {
          status: "unavailable" as const,
          reason: "observation_scope_mismatch",
          retryable: true,
        }
      : props.summary;
  const available = summary?.status === "available" ? summary.value : null;
  if (props.children)
    return (
      <>
        {props.children({
          summary,
          provider,
          isLoading: summary === undefined,
          isEmpty: !!available?.complete && available.eventCount === 0,
        })}
      </>
    );
  return (
    <section
      data-better-stripe="usage-summary"
      className={props.className}
      aria-label="Usage summary"
      aria-busy={summary === undefined}
    >
      <h2>Usage by meter</h2>
      {!summary ? (
        <p role="status">Loading usage…</p>
      ) : summary.status !== "available" ? (
        <p role="status">
          Usage {summary.status}. Refresh when original usage evidence is
          available.
        </p>
      ) : (
        <>
          <p>
            Period {formatUsageTime(summary.value.period.start)} to{" "}
            {formatUsageTime(summary.value.period.end)}
          </p>
          {!summary.value.complete && (
            <p role="status">Local history incomplete. Totals are partial.</p>
          )}
          {summary.value.complete && summary.value.eventCount === 0 && (
            <p>No usage in this period.</p>
          )}
          {summary.value.groups.map((group) => (
            <article
              key={JSON.stringify([
                group.binding.stripePriceId,
                group.subscription.subscriptionItemId,
                group.subscription.period,
              ])}
              data-billing-model={group.binding.plan.model}
            >
              <h3>
                {group.binding.plan.unit.name} ·{" "}
                {models[group.binding.plan.model]}
              </h3>
              <p>
                Plan {group.binding.plan.key}, version{" "}
                {group.binding.plan.version}
              </p>
              <dl>
                <dt>Accepted usage</dt>
                <dd>
                  {group.acceptedQuantity} {group.binding.plan.unit.name}
                </dd>
                <dt>Billable after corrections</dt>
                <dd>
                  {group.effectiveQuantity} {group.binding.plan.unit.name}
                </dd>
                <dt>Provider accepted</dt>
                <dd>
                  {group.providerAcceptedQuantity}{" "}
                  {group.binding.plan.unit.name}
                </dd>
                {Object.entries(group.deliveryQuantities)
                  .filter(
                    ([kind, quantity]) =>
                      kind !== "provider_accepted" &&
                      !/^0(?:\.0+)?$/.test(quantity),
                  )
                  .map(([kind, quantity]) => (
                    <div key={kind}>
                      <dt>
                        {deliveryLabels[kind as keyof typeof deliveryLabels]}
                      </dt>
                      <dd>
                        {quantity} {group.binding.plan.unit.name}
                      </dd>
                    </div>
                  ))}
              </dl>
              {group.validationErrorEventCount > 0 && (
                <p role="status">
                  Native validation rejected {group.validationErrorEventCount}{" "}
                  event(s).
                </p>
              )}
              {group.estimate.status === "available" ? (
                <p>
                  Estimated usage charge:{" "}
                  {formatUsageEstimate(
                    group.estimate.value.amountDecimal,
                    group.estimate.value.currency,
                  ) ?? "Unavailable"}
                </p>
              ) : (
                <p>
                  Estimate {group.estimate.status}. Complete original usage and
                  pricing evidence is required.
                </p>
              )}
              {group.included.status === "available" && (
                <dl>
                  <dt>Included units</dt>
                  <dd>{group.included.value.included}</dd>
                  <dt>Remaining included units</dt>
                  <dd>{group.included.value.remaining}</dd>
                  <dt>Overage units</dt>
                  <dd>{group.included.value.overage}</dd>
                </dl>
              )}
            </article>
          ))}
          <p>
            Estimate only. Finalized invoices and verified payments determine
            billing.
          </p>
        </>
      )}
      {!provider || provider.status !== "available" ? (
        <p role="status">
          Native aggregation {provider?.status ?? "unavailable"}. Refresh after
          provider ingestion.
        </p>
      ) : (
        <>
          <p>Native aggregate: {provider.value.quantity}</p>
          {provider.value.stale && (
            <p role="status">Native aggregation stale.</p>
          )}
          {!provider.value.complete && (
            <p role="status">
              Native aggregation partial. More provider pages remain.
            </p>
          )}
          <p>
            Aggregation may be delayed. Provider acceptance does not prove
            ingestion or payment.
          </p>
        </>
      )}
    </section>
  );
}
