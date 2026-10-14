"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type AffiliatePayoutUpdate = {
  affiliateBasisPoints: number | null;
  /** Major units of the sale currency, for example 5 means EUR 5 on a EUR sale. */
  affiliateFixedAmount: number | null;
  expectedVersion: number;
};
export type AffiliatePayoutEditorState = {
  value: string;
  mode: "percentage" | "fixed";
  currencySymbol: string;
  setValue: (value: string) => void;
  setMode: (mode: "percentage" | "fixed") => void;
  effectiveLabel: string;
  save: () => Promise<unknown>;
  clear: () => Promise<unknown>;
  isPending: boolean;
  error: string | null;
  message: string | undefined;
};
export type AffiliatePayoutEditorProps = {
  scopeKey: string;
  affiliateBasisPoints: number | null;
  affiliateFixedAmount?: number | null;
  effectiveBasisPoints: number;
  effectiveFixedAmount?: number | null;
  source?: "plan" | "product" | "price" | "store" | "global" | "none";
  currency?: string;
  version: number;
  onSave: (update: AffiliatePayoutUpdate) => Promise<unknown>;
  children?: (state: AffiliatePayoutEditorState) => ReactNode;
};
/** Unstyled inline payout editor. Clear saves inheritance; explicit zero disables payouts. */
export function AffiliatePayoutEditor(props: AffiliatePayoutEditorProps) {
  const id = useId();
  const currency = (props.currency ?? "usd").toUpperCase();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      }),
    [currency],
  );
  const currencySymbol =
    formatter.formatToParts(0).find((part) => part.type === "currency")
      ?.value ?? currency;
  const scope = `${props.scopeKey}:${props.version}`;
  const initial = {
    scope,
    mode:
      props.affiliateFixedAmount != null
        ? ("fixed" as const)
        : ("percentage" as const),
    value:
      props.affiliateFixedAmount != null
        ? String(props.affiliateFixedAmount)
        : props.affiliateBasisPoints == null
          ? ""
          : String(props.affiliateBasisPoints / 100),
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
  const action = useWorkflowAction(async (clear = false) => {
    const value = clear ? "" : fields.value.trim();
    const amount = value === "" ? null : Number(value);
    if (
      amount !== null &&
      (!/^\d+(\.\d{1,2})?$/.test(value) ||
        !Number.isSafeInteger(Math.round(amount * 100)) ||
        amount < 0 ||
        (fields.mode === "percentage" && amount > 100))
    )
      throw new Error(
        "Enter a non-negative amount with at most two decimals, or a percentage from 0 to 100.",
      );
    await props.onSave({
      affiliateBasisPoints:
        fields.mode === "percentage" && amount !== null
          ? Math.round(amount * 100)
          : null,
      affiliateFixedAmount: fields.mode === "fixed" ? amount : null,
      expectedVersion: props.version,
    });
    if (clear)
      setFields((previous) =>
        previous.scope === scope ? { ...previous, value: "" } : previous,
      );
    return clear
      ? "Affiliate payout cleared. Using the inherited default."
      : "Affiliate payout saved.";
  }, props.scopeKey);
  const state: AffiliatePayoutEditorState = {
    ...fields,
    currencySymbol,
    setValue: (value) => setFields((previous) => ({ ...previous, value })),
    setMode: (mode) => setFields((previous) => ({ ...previous, mode })),
    effectiveLabel: `Effective payout: ${props.effectiveFixedAmount != null ? formatter.format(props.effectiveFixedAmount) : `${props.effectiveBasisPoints / 100}%`}${props.source && props.source !== "none" ? ` from ${props.source === "plan" ? "store plan" : props.source}` : ""}.`,
    save: () => action.run(false),
    clear: () => action.run(true),
    isPending: action.isPending,
    error: action.error,
    message: action.result,
  };
  if (props.children) return <>{props.children(state)}</>;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <label htmlFor={id}>Affiliate payout</label>
      <input
        id={id}
        inputMode="decimal"
        value={state.value}
        disabled={state.isPending}
        onChange={(event) => state.setValue(event.target.value)}
      />
      <button
        type="button"
        aria-label="Percentage"
        aria-pressed={state.mode === "percentage"}
        disabled={state.isPending}
        onClick={() => state.setMode("percentage")}
      >
        %
      </button>
      <button
        type="button"
        aria-label={`Fixed amount in ${currency}`}
        aria-pressed={state.mode === "fixed"}
        disabled={state.isPending}
        onClick={() => state.setMode("fixed")}
      >
        {currencySymbol}
      </button>
      <button type="submit" disabled={state.isPending}>
        Save
      </button>
      <button
        type="button"
        aria-label="Clear affiliate payout"
        disabled={state.isPending}
        onClick={() => void state.clear()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <p>
        {state.effectiveLabel} Blank inherits the default. Fixed payouts are
        capped at proceeds after fees.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
