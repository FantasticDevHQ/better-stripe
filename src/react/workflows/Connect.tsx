"use client";
import { useState, type ReactNode } from "react";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectBalances,
  ConnectDisputesList,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
} from "@stripe/react-connect-js";
import {
  ConnectProvider,
  type ConnectProviderProps,
} from "../components/ConnectProvider.js";
export type ConnectComponent =
  | "account"
  | "onboarding"
  | "payments"
  | "refunds"
  | "disputes"
  | "balances"
  | "payouts"
  | "notifications";
export type ConnectRenderProps = {
  content: ReactNode;
  error: string | null;
  retry: () => void;
  completed: boolean;
};
export type ConnectProps = Omit<ConnectProviderProps, "children"> & {
  component: ConnectComponent;
  /** Remounts the Stripe instance when the authenticated account changes. The server must authorize it independently. */
  scopeKey: string;
  onExit?: () => void;
  children?: (state: ConnectRenderProps) => ReactNode;
};
const widgets = {
  account: ConnectAccountManagement,
  onboarding: ConnectAccountOnboarding,
  payments: ConnectPayments,
  refunds: ConnectPayments,
  disputes: ConnectDisputesList,
  balances: ConnectBalances,
  payouts: ConnectPayouts,
  notifications: ConnectNotificationBanner,
};
/** Unstyled, account-scoped Connect component with session refresh, error recovery, appearance, and locale. */
export function Connect(props: ConnectProps) {
  return (
    <ConnectBody key={`${props.scopeKey}:${props.component}`} {...props} />
  );
}
function ConnectBody({
  component,
  publishableKey,
  fetchClientSecret,
  appearance,
  locale,
  onExit,
  children,
}: ConnectProps) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const Widget = widgets[component];
  const retry = () => {
    setError(null);
    setAttempt((value) => value + 1);
  };
  const content = error ? (
    <div role="alert">
      <p>{error}</p>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  ) : (
    <ConnectProvider
      key={attempt}
      publishableKey={publishableKey}
      appearance={appearance}
      locale={locale}
      fetchClientSecret={async () => {
        try {
          return await fetchClientSecret();
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
          throw error;
        }
      }}
    >
      <Widget
        onLoadError={({ error }) =>
          setError(error.message ?? "Stripe could not load this component.")
        }
        onExit={() => {
          setCompleted(true);
          onExit?.();
        }}
      />
    </ConnectProvider>
  );
  return (
    <>{children ? children({ content, error, retry, completed }) : content}</>
  );
}
