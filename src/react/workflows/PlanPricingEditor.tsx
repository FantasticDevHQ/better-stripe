"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type PlanPricing = {
  id: string;
  name: string;
  monthlyAmount: number;
  feeBasisPoints: number | null;
  version: number;
};
export type PlanPricingUpdate = {
  monthlyAmount: number;
  feeBasisPoints: number | null;
  expectedVersion: number;
};
export type PlanPricingEditorState = {
  monthlyPrice: string;
  saleFee: string;
  setMonthlyPrice: (value: string) => void;
  setSaleFee: (value: string) => void;
  save: () => Promise<unknown>;
  isPending: boolean;
  error: string | null;
  message: string | undefined;
};
export type PlanPricingEditorProps = {
  plan: PlanPricing;
  onSave: (update: PlanPricingUpdate) => Promise<unknown>;
  children?: (state: PlanPricingEditorState) => ReactNode;
};
/** Unstyled store-plan pricing editor. Authorization and Stripe price creation belong on the server. */
export function PlanPricingEditor({
  plan,
  onSave,
  children,
}: PlanPricingEditorProps) {
  const id = useId();
  const scope = `${plan.id}:${plan.version}`;
  const initial = {
    scope,
    monthlyPrice: (plan.monthlyAmount / 100).toFixed(2),
    saleFee:
      plan.feeBasisPoints === null ? "" : String(plan.feeBasisPoints / 100),
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
  const action = useWorkflowAction(async () => {
    if (!/^\d+(\.\d{1,2})?$/.test(fields.monthlyPrice.trim()))
      throw new Error(
        "Enter a positive monthly price with at most two decimal places.",
      );
    const monthlyAmount = Math.round(Number(fields.monthlyPrice) * 100);
    if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount <= 0)
      throw new Error("Enter a positive monthly price.");
    const feeBasisPoints =
      fields.saleFee.trim() === ""
        ? null
        : Math.round(Number(fields.saleFee) * 100);
    if (
      feeBasisPoints !== null &&
      (!/^\d+(\.\d{1,2})?$/.test(fields.saleFee.trim()) ||
        !Number.isSafeInteger(feeBasisPoints) ||
        feeBasisPoints < 0 ||
        feeBasisPoints > 10000)
    )
      throw new Error(
        "Enter a sale fee from 0 to 100%, with at most two decimal places, or leave it blank for Stripe processing only.",
      );
    await onSave({
      monthlyAmount,
      feeBasisPoints,
      expectedVersion: plan.version,
    });
    return "Pricing saved. Existing subscriptions keep their monthly price.";
  }, plan.id);
  const state: PlanPricingEditorState = {
    ...fields,
    setMonthlyPrice: (monthlyPrice) =>
      setFields((previous) => ({ ...previous, monthlyPrice })),
    setSaleFee: (saleFee) =>
      setFields((previous) => ({ ...previous, saleFee })),
    save: action.run,
    isPending: action.isPending,
    error: action.error,
    message: action.result,
  };
  if (children) return <>{children(state)}</>;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
      aria-label={`${plan.name} pricing`}
    >
      <h3>{plan.name}</h3>
      <label htmlFor={`${id}-monthly`}>Monthly price (USD)</label>
      <input
        id={`${id}-monthly`}
        inputMode="decimal"
        value={state.monthlyPrice}
        disabled={state.isPending}
        onChange={(event) => state.setMonthlyPrice(event.target.value)}
      />
      <label htmlFor={`${id}-fee`}>Sale fee (%)</label>
      <input
        id={`${id}-fee`}
        inputMode="decimal"
        value={state.saleFee}
        disabled={state.isPending}
        onChange={(event) => state.setSaleFee(event.target.value)}
      />
      <p>
        Leave the sale fee blank for Stripe processing only. The seller always
        covers actual Stripe processing costs.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={state.isPending}>
        {state.isPending ? "Saving…" : "Save pricing"}
      </button>
    </form>
  );
}
