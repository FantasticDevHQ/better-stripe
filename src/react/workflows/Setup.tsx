"use client";
import type { ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
export type WebhookSetupOptions<Status, Result> = {
  scopeKey: string;
  load: () => Promise<Status>;
  setup: () => Promise<Result>;
};
export function useWebhookSetup<Status, Result>(
  props: WebhookSetupOptions<Status, Result>,
) {
  const status = useWorkflowResource(props.load, props.scopeKey);
  const setup = useWorkflowAction(
    async () => ({ value: await props.setup() }),
    props.scopeKey,
  );
  return {
    status: status.data,
    isChecking: status.isLoading,
    statusError: status.error,
    checkStatus: status.refresh,
    result: setup.result?.value,
    isPending: setup.isPending,
    error: setup.error,
    configure: async () => {
      if (await setup.run()) status.refresh();
    },
  };
}
export function WebhookSetup<Status, Result>(
  props: WebhookSetupOptions<Status, Result> & {
    renderStatus?: (status: Status) => ReactNode;
    children?: (
      state: ReturnType<typeof useWebhookSetup<Status, Result>>,
    ) => ReactNode;
  },
) {
  const state = useWebhookSetup(props);
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section data-better-stripe="webhook-setup">
      <h2>Webhook destinations</h2>
      {(state.error || state.statusError) && (
        <p role="alert">{state.error || state.statusError}</p>
      )}
      {state.isChecking ? (
        <p role="status">Checking destinations…</p>
      ) : state.status !== undefined && props.renderStatus ? (
        props.renderStatus(state.status)
      ) : (
        <p>Destination status loaded.</p>
      )}
      <button
        type="button"
        disabled={state.isPending || state.isChecking}
        onClick={() => {
          void state.configure();
        }}
      >
        {state.isPending ? "Configuring…" : "Configure webhooks"}
      </button>
      <button
        type="button"
        disabled={state.isChecking}
        onClick={state.checkStatus}
      >
        Refresh status
      </button>
    </section>
  );
}
export type EnvironmentCheck = {
  id: string;
  label: string;
  configured: boolean;
};
export function EnvironmentStatus({
  checks,
  isLoading = checks === undefined,
  error,
  children,
}: {
  checks: EnvironmentCheck[] | undefined;
  isLoading?: boolean;
  error?: string | null;
  children?: (state: {
    checks: EnvironmentCheck[];
    allConfigured: boolean;
    isLoading: boolean;
    error: string | null;
  }) => ReactNode;
}) {
  const state = {
    checks: checks ?? [],
    allConfigured:
      !!checks?.length && checks.every((check) => check.configured),
    isLoading,
    error: error ?? null,
  };
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="environment-status">
      <h2>Environment</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : isLoading ? (
        <p role="status">Checking configuration…</p>
      ) : !checks?.length ? (
        <p>No environment checks configured.</p>
      ) : (
        <ul>
          {checks.map((check) => (
            <li key={check.id}>
              {check.label}: {check.configured ? "Set" : "Not set"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export type FixtureProgressState = {
  cursor: number;
  total: number;
  status: string;
  error?: string;
};
export function FixtureProgress({
  state,
  children,
}: {
  state: FixtureProgressState | null | undefined;
  children?: (
    state: FixtureProgressState & { progress: number; message: string },
  ) => ReactNode;
}) {
  if (!state) return <p>No fixture run yet.</p>;
  const result = {
    ...state,
    progress:
      state.total > 0
        ? Math.max(0, Math.min(1, state.cursor / state.total))
        : 0,
    message:
      state.status === "running"
        ? "Fixtures are being created. Stripe events continue to update your data."
        : state.status === "complete"
          ? "Fixtures are populated. Stripe statuses can continue updating through webhooks."
          : "Population stopped. Resume to retry this step.",
  };
  if (children) return <>{children(result)}</>;
  return (
    <div data-better-stripe="fixture-progress">
      <progress
        aria-label="Sandbox fixture progress"
        value={result.progress}
        max={1}
      />
      <p role="status">
        {state.cursor} of {state.total} steps complete. {result.message}
      </p>
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}
