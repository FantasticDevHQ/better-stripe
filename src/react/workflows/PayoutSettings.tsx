"use client";
import { useId, useState, type ReactNode } from "react";
import type { PayoutPolicy } from "../../client/payoutPolicy.js";
import {
  chargeAmountToDecimal,
  parseChargeAmount,
} from "../../client/charge-currency.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type PayoutSettingsChange = {
  currency: string;
  mode: "custom" | "stripe_managed";
  expectedRevision: number;
  minimum?: number;
  consent: boolean;
};
export type PayoutSettingsResult = {
  status:
    | "ready"
    | "unsupported"
    | "migration_required"
    | "schedule_drift"
    | "canceled";
  reason?: string;
};
export type PayoutSettingsProps = {
  scopeKey: string;
  currency: string;
  policy:
    | Pick<PayoutPolicy, "mode" | "status" | "revision" | "thresholds">
    | null
    | undefined;
  onSave: (change: PayoutSettingsChange) => Promise<PayoutSettingsResult>;
  onRetry?: () => Promise<PayoutSettingsResult>;
  children?: (state: PayoutSettingsState) => ReactNode;
};
export type PayoutSettingsState = {
  inputId: string;
  currency: string;
  mode: "custom" | "stripe_managed";
  setMode: (mode: "custom" | "stripe_managed") => void;
  minimum: string;
  setMinimum: (minimum: string) => void;
  consent: boolean;
  setConsent: (consent: boolean) => void;
  isLoading: boolean;
  isChanging: boolean;
  isPending: boolean;
  canSave: boolean;
  error: string | null;
  message: string | null;
  save: () => Promise<unknown>;
  retry: () => Promise<unknown>;
};
const messages: Record<PayoutSettingsResult["status"], string> = {
  ready: "Payout settings verified.",
  migration_required:
    "Existing funds or payouts need reconciliation before this schedule can change.",
  unsupported:
    "Custom payout scheduling is unavailable for this account. Review the current policy and Stripe schedule.",
  schedule_drift:
    "The Stripe payout schedule changed. Reconciliation is required before this operation can complete.",
  canceled:
    "The settings change was canceled. Refresh to view the current payout policy.",
};
/** Host callbacks authorize ownership and persist immutable schedule operations. */
export function usePayoutSettings(
  props: PayoutSettingsProps,
): PayoutSettingsState {
  const inputId = useId();
  const scope = `${props.scopeKey}:${props.currency}:${props.policy?.revision ?? -1}:${props.policy?.status ?? "default"}`;
  const configured = props.policy?.thresholds.find(
    (t) => t.currency === props.currency,
  );
  const initial = {
    scope,
    mode: props.policy?.mode ?? ("stripe_managed" as const),
    minimum: configured
      ? (chargeAmountToDecimal(configured.amount, props.currency) ?? "")
      : "",
    consent: false,
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
  const isLoading = props.policy === undefined;
  const isChanging = props.policy?.status === "changing";
  // This only parses ordinary currency units; provider capability/floor checks stay on the server.
  const minimum = parseChargeAmount(fields.minimum.trim(), props.currency);
  const valid =
    fields.mode === "stripe_managed" ||
    (minimum !== null && minimum > 0 && fields.consent);
  const action = useWorkflowAction(async (retry: boolean) => {
    if (retry) {
      if (!props.onRetry) throw new Error("Settings retry is unavailable.");
      return props.onRetry();
    }
    if (isLoading || isChanging || !valid)
      throw new Error(
        "Enter a positive minimum and consent to custom scheduling before saving.",
      );
    return props.onSave({
      currency: props.currency,
      expectedRevision: props.policy?.revision ?? -1,
      mode: fields.mode,
      ...(fields.mode === "custom" ? { minimum: minimum! } : {}),
      consent: fields.mode === "custom" && fields.consent,
    });
  }, scope);
  const update = (values: Partial<typeof fields>) => {
    action.reset();
    setFields((old) => ({ ...old, ...values }));
  };
  return {
    inputId,
    currency: props.currency,
    mode: fields.mode,
    minimum: fields.minimum,
    consent: fields.consent,
    setMode: (mode) => update({ mode, consent: false }),
    setMinimum: (minimum) => update({ minimum }),
    setConsent: (consent) => update({ consent }),
    isLoading,
    isChanging,
    isPending: action.isPending,
    canSave: !isLoading && !isChanging && !action.isPending && valid,
    error: action.error,
    message: action.result ? messages[action.result.status] : null,
    save: () => action.run(false),
    retry: () => action.run(true),
  };
}
/** Unstyled account-wide schedule editor. It offers no payout or withdrawal action. */
export function PayoutSettings(props: PayoutSettingsProps) {
  const state = usePayoutSettings(props);
  if (props.children) return <>{props.children(state)}</>;
  return (
    <form
      data-better-stripe="payout-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <h2>Payout settings</h2>
      <label htmlFor={`${state.inputId}-mode`}>Automatic payout policy</label>
      <select
        id={`${state.inputId}-mode`}
        value={state.mode}
        disabled={state.isLoading || state.isPending || state.isChanging}
        onChange={(event) =>
          state.setMode(event.target.value as PayoutSettingsState["mode"])
        }
      >
        <option value="stripe_managed">
          Stripe-managed automatic payouts, all currencies
        </option>
        <option value="custom">Custom combined minimum</option>
      </select>
      {state.mode === "custom" && (
        <>
          <label htmlFor={`${state.inputId}-minimum`}>
            Minimum ({props.currency.toUpperCase()})
          </label>
          <input
            id={`${state.inputId}-minimum`}
            inputMode="decimal"
            value={state.minimum}
            disabled={state.isPending || state.isChanging}
            onChange={(event) => state.setMinimum(event.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={state.consent}
              disabled={state.isPending || state.isChanging}
              onChange={(event) => state.setConsent(event.target.checked)}
            />
            I agree to hold funds in my Stripe balance until the combined
            minimum is met, subject to the holding deadline.
          </label>
          <p>
            Store and affiliate earnings combine per currency. Below-minimum
            funds remain owed. Other currency minimums are preserved.
          </p>
        </>
      )}
      {state.isLoading && <p role="status">Loading payout settings…</p>}
      {state.isChanging && (
        <p role="status">
          A settings change is being verified. The automatic worker will resume
          it.
        </p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={!state.canSave}>
        {state.isPending ? "Saving…" : "Save payout settings"}
      </button>
      {state.isChanging && props.onRetry && (
        <button
          type="button"
          disabled={state.isPending}
          onClick={() => void state.retry()}
        >
          Retry settings verification
        </button>
      )}
    </form>
  );
}
