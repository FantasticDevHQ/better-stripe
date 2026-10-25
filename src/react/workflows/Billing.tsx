"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { formatPrice } from "../lib/price-helpers.js";
export type EstimatedInvoice = {
  currency: string;
  total: number;
  nextBillingAt: number;
  lines: {
    id: string;
    description: string;
    amount: number;
    sourceType?: string;
  }[];
};
export function useInvoiceEstimate(
  load: () => Promise<EstimatedInvoice>,
  scopeKey: string,
) {
  const action = useWorkflowAction(load, scopeKey);
  return {
    invoice: action.result,
    isPending: action.isPending,
    error: action.error,
    refresh: action.run,
  };
}
export type InvoiceEstimateProps = {
  scopeKey: string;
  load: () => Promise<EstimatedInvoice>;
  children?: (state: ReturnType<typeof useInvoiceEstimate>) => ReactNode;
};
export function InvoiceEstimate({
  scopeKey,
  load,
  children,
}: InvoiceEstimateProps) {
  const state = useInvoiceEstimate(load, scopeKey);
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="invoice-estimate">
      <h2>Estimated next invoice</h2>
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void state.refresh();
        }}
      >
        {state.isPending
          ? "Loading…"
          : state.invoice
            ? "Refresh estimate"
            : "View estimate"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.invoice && (
        <>
          <p>
            Next billing date:{" "}
            {new Date(state.invoice.nextBillingAt).toLocaleDateString()}
          </p>
          <ul>
            {state.invoice.lines.map((line) => (
              <li key={line.id}>
                {line.description}{" "}
                <span>{formatPrice(line.amount, state.invoice!.currency)}</span>
              </li>
            ))}
          </ul>
          <p>
            Estimated total:{" "}
            <span>
              {formatPrice(state.invoice.total, state.invoice.currency)}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
export type BalanceFundingActions = {
  scopeKey: string;
  change: (args: { enabled: boolean; consent?: true }) => Promise<unknown>;
};
export function useBalanceFunding({ scopeKey, change }: BalanceFundingActions) {
  const [state, setState] = useState({ scope: scopeKey, consent: false });
  if (state.scope !== scopeKey) setState({ scope: scopeKey, consent: false });
  const action = useWorkflowAction(async (enabled: boolean) => {
    if (enabled && !state.consent)
      throw new Error(
        "Explicit consent is required to debit a Stripe balance.",
      );
    await change({ enabled, consent: enabled ? true : undefined });
    return true;
  }, scopeKey);
  return {
    consent: state.consent,
    setConsent: (consent: boolean) =>
      setState((previous) => ({ ...previous, consent })),
    error: action.error,
    isPending: action.isPending,
    confirm: async (enabled: boolean) => {
      if (await action.run(enabled))
        setState((previous) => ({ ...previous, consent: false }));
    },
  };
}
export type BalancePaymentSourceProps = BalanceFundingActions & {
  enabled: boolean | undefined;
  consentLabel?: string;
  children?: (
    state: ReturnType<typeof useBalanceFunding> & {
      enabled: boolean | undefined;
    },
  ) => ReactNode;
};
export function BalancePaymentSource(props: BalancePaymentSourceProps) {
  const state = useBalanceFunding(props);
  const id = useId();
  if (props.children)
    return <>{props.children({ ...state, enabled: props.enabled })}</>;
  return (
    <section data-better-stripe="balance-payment-source">
      <h2>Payment source</h2>
      <p role="status">
        {props.enabled === undefined
          ? "Loading…"
          : props.enabled
            ? "Pay from Stripe balance"
            : "Pay with saved payment method"}
      </p>
      <p>
        If your Stripe balance is insufficient, payment can fail. Switch to a
        saved payment method to pay instead.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {props.enabled === false && (
        <>
          <label htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={state.consent}
              onChange={(event) => state.setConsent(event.target.checked)}
            />
            {props.consentLabel ??
              "I authorize recurring platform charges from my Stripe balance."}
          </label>
          <button
            type="button"
            disabled={!state.consent || state.isPending}
            onClick={() => {
              void state.confirm(true);
            }}
          >
            {state.isPending ? "Saving…" : "Confirm balance payments"}
          </button>
        </>
      )}
      {props.enabled && (
        <button
          type="button"
          disabled={state.isPending}
          onClick={() => {
            void state.confirm(false);
          }}
        >
          Use saved payment method
        </button>
      )}
    </section>
  );
}
export type BillingPortalProps = {
  scopeKey?: string;
  createSession: () => Promise<string | { url: string }>;
  onNavigate?: (url: string) => void;
  children?: (state: {
    open: () => Promise<true | undefined>;
    isPending: boolean;
    error: string | null;
  }) => ReactNode;
};
export function BillingPortal(props: BillingPortalProps) {
  const action = useWorkflowAction(
    async () => {
      const result = await props.createSession();
      const url = typeof result === "string" ? result : result.url;
      if (!url) throw new Error("Stripe did not return a portal URL.");
      return url;
    },
    props.scopeKey,
    (url) => {
      (props.onNavigate ?? ((nextUrl) => window.location.assign(nextUrl)))(url);
    },
  );
  const open = async (): Promise<true | undefined> =>
    (await action.run()) === undefined ? undefined : true;
  const state = {
    open,
    isPending: action.isPending,
    error: action.error,
  };
  if (props.children) return <>{props.children(state)}</>;
  return (
    <div data-better-stripe="billing-portal">
      {action.error && <p role="alert">{action.error}</p>}
      <button
        type="button"
        disabled={action.isPending}
        onClick={() => {
          void action.run();
        }}
      >
        {action.isPending ? "Opening portal…" : "Open Stripe Billing Portal"}
      </button>
    </div>
  );
}
