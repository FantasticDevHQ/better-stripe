"use client";
import { usageSnapshotMatches } from "./usage-scope.js";
import type { ReactNode } from "react";
import { useWorkflowResource } from "./useWorkflowResource.js";
import { UsageSummary } from "./UsageSummary.js";
import { UsageAllowance } from "./UsageAllowance.js";
import { UsageCredits } from "./UsageCredits.js";
import {
  usageViewKey,
  type UsageBillingSnapshot,
  type UsageViewScope,
} from "./Usage.types.js";
export type UsageBillingProps = {
  scope: UsageViewScope;
  /** Authenticate and derive the original native binding in the host, including every refresh. */
  load: (scope: UsageViewScope) => Promise<UsageBillingSnapshot>;
  unit?: string;
  className?: string;
  children?: (state: ReturnType<typeof useUsageBilling>) => ReactNode;
};
export function useUsageBilling({
  scope,
  load,
}: Pick<UsageBillingProps, "scope" | "load">) {
  const resource = useWorkflowResource(async () => {
    try {
      const data = await load(scope);
      if (!usageSnapshotMatches(scope, data))
        throw new Error("Observation scope mismatch");
      return data;
    } catch {
      throw new Error("Usage unavailable. Try again.");
    }
  }, usageViewKey(scope));
  return resource;
}
/** Shared workflow for component-backed and via-API host adapters. No browser provider credentials. */
export function UsageBilling(props: UsageBillingProps) {
  return <UsageBillingBody key={usageViewKey(props.scope)} {...props} />;
}
function UsageBillingBody(props: UsageBillingProps) {
  const state = useUsageBilling(props);
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section
      data-better-stripe="usage-billing"
      className={props.className}
      aria-label="Metered billing"
      aria-busy={state.isLoading}
    >
      <button type="button" onClick={state.refresh} disabled={state.isLoading}>
        Refresh usage
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {(state.isLoading || state.error) && state.data && (
        <p role="status">
          Refreshing usage. Displayed observations may be stale.
        </p>
      )}
      <UsageSummary
        scope={props.scope}
        summary={
          state.data?.summary ??
          (state.error
            ? {
                status: "unavailable",
                reason: "read_unavailable",
                retryable: true,
              }
            : undefined)
        }
        provider={state.data?.provider}
      />
      {state.data?.allowance && (
        <UsageAllowance
          allowance={state.data.allowance}
          unit={props.unit ?? "units"}
        />
      )}
      {state.data?.credits && (
        <UsageCredits
          currency={props.scope.currency}
          balance={state.data.credits}
          purchase={state.data.purchase}
          application={state.data.creditApplication}
        />
      )}
    </section>
  );
}
