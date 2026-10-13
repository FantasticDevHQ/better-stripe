"use client";
import { useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { Connect, type ConnectProps } from "./Connect.js";
export type AccountConfiguration = "customer" | "recipient" | "merchant";
export type AccountManagerOptions = {
  scopeKey: string;
  createDashboardLink?: () => Promise<{ url: string }>;
  configure?: (configuration: AccountConfiguration) => Promise<unknown>;
  onNavigate?: (url: string) => void;
};
export function useAccountManager(props: AccountManagerOptions) {
  const [configuration, setConfiguration] =
    useState<AccountConfiguration | null>(null);
  const action = useWorkflowAction(
    async (
      command:
        | { type: "login" }
        | { type: "configure"; configuration: AccountConfiguration },
    ) => {
      if (command.type === "login") {
        if (!props.createDashboardLink)
          throw new Error("Dashboard access is not configured.");
        const result = await props.createDashboardLink();
        if (!result.url)
          throw new Error("Stripe did not return a dashboard URL.");
        return { type: "login" as const, url: result.url };
      }
      setConfiguration(command.configuration);
      if (!props.configure)
        throw new Error("Account configuration is not supported.");
      await props.configure(command.configuration);
      return {
        type: "configure" as const,
        configuration: command.configuration,
      };
    },
    props.scopeKey,
  );
  return {
    pendingConfiguration: action.isPending ? configuration : null,
    lastConfiguration: configuration,
    isPending: action.isPending,
    error: action.error,
    result: action.result,
    openDashboard: async () => {
      const result = await action.run({ type: "login" });
      if (result?.type === "login")
        (props.onNavigate ?? ((url) => window.location.assign(url)))(
          result.url,
        );
    },
    configure: (configuration: AccountConfiguration) =>
      action.run({ type: "configure", configuration }),
  };
}
export type AccountSummary = {
  stripeAccountId: string;
  email?: string;
  country?: string;
  onboardingStatus?: string;
  configurations?: string[];
  missingRequirements?: string[];
};
export type HeadlessAccountProps = AccountManagerOptions & {
  presentation?: "headless";
  account: AccountSummary | null | undefined;
  children?: (
    state: ReturnType<typeof useAccountManager> & {
      account: AccountSummary | null | undefined;
    },
  ) => ReactNode;
};
export type AccountProps =
  | HeadlessAccountProps
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
export function Account(props: AccountProps) {
  return props.presentation === "embedded" ? (
    <Connect {...props} component="account" />
  ) : (
    <AccountBody key={props.scopeKey} {...props} />
  );
}
function AccountBody(props: HeadlessAccountProps) {
  const state = useAccountManager(props);
  if (props.children)
    return <>{props.children({ ...state, account: props.account })}</>;
  if (props.account === undefined) return <p role="status">Loading account…</p>;
  if (!props.account) return <p>No Stripe account has been set up.</p>;
  return (
    <section data-better-stripe="account" aria-busy={state.isPending}>
      <h2>Account</h2>
      <dl>
        <dt>Account ID</dt>
        <dd>{props.account.stripeAccountId}</dd>
        <dt>Email</dt>
        <dd>{props.account.email ?? "Not supplied"}</dd>
        <dt>Country</dt>
        <dd>{props.account.country ?? "Not supplied"}</dd>
        <dt>Status</dt>
        <dd>{props.account.onboardingStatus ?? "pending"}</dd>
      </dl>
      {state.error && <p role="alert">{state.error}</p>}
      {props.createDashboardLink && (
        <button
          type="button"
          disabled={state.isPending}
          onClick={() => {
            void state.openDashboard();
          }}
        >
          {state.isPending ? "Opening…" : "Open Stripe dashboard"}
        </button>
      )}
      <h3>Configurations</h3>
      {props.account.configurations?.length ? (
        <ul>
          {props.account.configurations.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>No configurations yet.</p>
      )}
      {props.configure &&
        (["customer", "recipient", "merchant"] as const)
          .filter((value) => !props.account!.configurations?.includes(value))
          .map((value) => (
            <button
              key={value}
              type="button"
              disabled={state.isPending}
              onClick={() => {
                void state.configure(value);
              }}
            >
              Add {value} configuration
            </button>
          ))}
      {!!props.account.missingRequirements?.length && (
        <>
          <h3>Requirements</h3>
          <ul>
            {props.account.missingRequirements.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export type AccountConfigurationsProps = {
  configurations: string[];
  children?: (state: {
    items: { key: string; label: string }[];
    isEmpty: boolean;
  }) => ReactNode;
};
export function AccountConfigurations({
  configurations,
  children,
}: AccountConfigurationsProps) {
  const labels: Record<string, string> = {
    recipient: "Recipient (payouts)",
    customer: "Customer (billable)",
    merchant: "Merchant (card payments)",
  };
  const items = configurations.map((key) => ({
    key,
    label: labels[key] ?? key,
  }));
  if (children) return <>{children({ items, isEmpty: !items.length })}</>;
  return items.length ? (
    <ul data-better-stripe="account-configurations">
      {items.map((item) => (
        <li key={item.key}>{item.label}</li>
      ))}
    </ul>
  ) : (
    <p>No configurations yet.</p>
  );
}
