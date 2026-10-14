"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type AffiliateRateUpdate = {
  affiliateBasisPoints: number | null;
  expectedVersion: number;
};
export type AffiliateRateEditorState = {
  percentage: string;
  setPercentage: (value: string) => void;
  effectiveLabel: string;
  isPending: boolean;
  error: string | null;
  message: string | undefined;
  save: () => Promise<unknown>;
};
export type AffiliateRateEditorProps = {
  scopeKey: string;
  affiliateBasisPoints: number | null;
  effectiveBasisPoints: number;
  source: "plan" | "product" | "price" | "store" | "global" | "none";
  version: number;
  onSave: (update: AffiliateRateUpdate) => Promise<unknown>;
  children?: (state: AffiliateRateEditorState) => ReactNode;
};
/** Unstyled nullable commission editor. Blank inherits the next applicable rate. */
export function AffiliateRateEditor(props: AffiliateRateEditorProps) {
  const id = useId();
  const scope = `${props.scopeKey}:${props.version}`;
  const initial = {
    scope,
    percentage:
      props.affiliateBasisPoints === null
        ? ""
        : String(props.affiliateBasisPoints / 100),
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
  const action = useWorkflowAction(async () => {
    const value = fields.percentage.trim();
    const rate = value === "" ? null : Math.round(Number(value) * 100);
    if (
      rate !== null &&
      (!/^\d+(\.\d{1,2})?$/.test(value) ||
        !Number.isSafeInteger(rate) ||
        rate < 0 ||
        rate > 10000)
    )
      throw new Error(
        "Enter a percentage from 0 to 100 with at most two decimal places, or leave it blank to inherit.",
      );
    await props.onSave({
      affiliateBasisPoints: rate,
      expectedVersion: props.version,
    });
    return "Affiliate payout saved.";
  }, props.scopeKey);
  const state: AffiliateRateEditorState = {
    percentage: fields.percentage,
    setPercentage: (percentage) =>
      setFields((previous) => ({ ...previous, percentage })),
    effectiveLabel: `Effective payout: ${props.effectiveBasisPoints / 100}% from ${props.source === "plan" ? "store plan" : props.source}.`,
    isPending: action.isPending,
    error: action.error,
    message: action.result,
    save: action.run,
  };
  if (props.children) return <>{props.children(state)}</>;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <label htmlFor={id}>Affiliate payout (%)</label>
      <input
        id={id}
        inputMode="decimal"
        value={state.percentage}
        disabled={state.isPending}
        onChange={(event) => state.setPercentage(event.target.value)}
      />
      <p>{state.effectiveLabel} Leave blank to inherit.</p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={state.isPending}>
        {state.isPending ? "Saving…" : "Save payout"}
      </button>
    </form>
  );
}
