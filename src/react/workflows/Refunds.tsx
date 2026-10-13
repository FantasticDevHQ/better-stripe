"use client";
import { useState, useId, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { Connect, type ConnectProps } from "./Connect.js";
export type RefundRequest = {
  stripePaymentIntentId: string;
  amountCents?: number;
  reason: "requested_by_customer";
};
export type ReversalRequest = { sourceChargeId: string; amountCents?: number };
export type RefundResult = { stripeRefundId: string };
export type ReversalResult = {
  reversals: { stripeTransferId: string; amount: number }[];
  summary: { reversalCount: number; totalReversed: number };
};
export type RefundActionsProps = {
  scopeKey: string;
  paymentIntentId?: string;
  sourceChargeId?: string;
  issueRefund: (args: RefundRequest) => Promise<RefundResult>;
  reverseTransfers?: (args: ReversalRequest) => Promise<ReversalResult>;
};
/** Currency input expressed in two decimal minor units. Rejects rounding and scientific notation. */
export function parseAmountCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
export function useRefunds(props: RefundActionsProps) {
  const initial = {
    scope: props.scopeKey,
    paymentIntentId: props.paymentIntentId ?? "",
    sourceChargeId: props.sourceChargeId ?? "",
    refundAmount: "",
    reversalAmount: "",
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== props.scopeKey) setFields(initial);
  const [operationType, setOperationType] = useState<"refund" | "reversal">(
    "refund",
  );
  const action = useWorkflowAction(
    async (operation: {
      type: "refund" | "reversal";
      kind: "full" | "partial";
    }) => {
      setOperationType(operation.type);
      const id = (
        operation.type === "refund"
          ? fields.paymentIntentId
          : fields.sourceChargeId
      ).trim();
      if (!id)
        throw new Error(
          operation.type === "refund"
            ? "Enter a PaymentIntent id before issuing a refund."
            : "Enter a source charge id before reversing transfers.",
        );
      const amount =
        operation.kind === "partial"
          ? parseAmountCents(
              operation.type === "refund"
                ? fields.refundAmount
                : fields.reversalAmount,
            )
          : undefined;
      if (amount === null)
        throw new Error(
          `Enter a positive partial ${operation.type === "refund" ? "refund" : "reversal"} amount with at most two decimal places.`,
        );
      if (operation.type === "refund")
        return {
          type: "refund" as const,
          value: await props.issueRefund({
            stripePaymentIntentId: id,
            amountCents: amount,
            reason: "requested_by_customer",
          }),
        };
      if (!props.reverseTransfers)
        throw new Error("Transfer reversals are not configured.");
      return {
        type: "reversal" as const,
        value: await props.reverseTransfers({
          sourceChargeId: id,
          amountCents: amount,
        }),
      };
    },
    props.scopeKey,
  );
  const set = (
    name:
      "paymentIntentId" | "sourceChargeId" | "refundAmount" | "reversalAmount",
    value: string,
  ) => setFields((previous) => ({ ...previous, [name]: value }));
  return {
    ...fields,
    setPaymentIntentId: (value: string) => set("paymentIntentId", value),
    setSourceChargeId: (value: string) => set("sourceChargeId", value),
    setRefundAmount: (value: string) => set("refundAmount", value),
    setReversalAmount: (value: string) => set("reversalAmount", value),
    error: action.error,
    isPending: action.isPending,
    busy: action.isPending ? operationType : null,
    refundResult: action.result?.type === "refund" ? action.result.value : null,
    reversalResult:
      action.result?.type === "reversal" ? action.result.value : null,
    submitRefund: (kind: "full" | "partial") =>
      action.run({ type: "refund", kind }),
    submitReversal: (kind: "full" | "partial") =>
      action.run({ type: "reversal", kind }),
  };
}
export type RefundsRenderProps = ReturnType<typeof useRefunds>;
export type RefundsProps =
  | (RefundActionsProps & {
      presentation?: "headless";
      children?: (state: RefundsRenderProps) => ReactNode;
    })
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
export function Refunds(props: RefundsProps) {
  return props.presentation === "embedded" ? (
    <Connect {...props} component="refunds" />
  ) : (
    <RefundsBody key={props.scopeKey} {...props} />
  );
}
function RefundsBody(
  props: RefundActionsProps & {
    children?: (state: RefundsRenderProps) => ReactNode;
  },
) {
  const state = useRefunds(props);
  const id = useId();
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section data-better-stripe="refunds" aria-busy={state.isPending}>
      <h2>Refunds</h2>
      {state.error && <p role="alert">{state.error}</p>}
      <label htmlFor={`${id}-payment`}>PaymentIntent ID</label>
      <input
        id={`${id}-payment`}
        value={state.paymentIntentId}
        onChange={(event) => state.setPaymentIntentId(event.target.value)}
      />
      <label htmlFor={`${id}-amount`}>Partial refund amount</label>
      <input
        id={`${id}-amount`}
        type="number"
        min="0.01"
        step="0.01"
        value={state.refundAmount}
        onChange={(event) => state.setRefundAmount(event.target.value)}
      />
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void state.submitRefund("full");
        }}
      >
        {state.isPending ? "Processing…" : "Full refund"}
      </button>
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void state.submitRefund("partial");
        }}
      >
        Partial refund
      </button>
      {state.refundResult && (
        <p role="status">Refund created: {state.refundResult.stripeRefundId}</p>
      )}
      {props.reverseTransfers && (
        <>
          <h3>Transfer reversals</h3>
          <label htmlFor={`${id}-charge`}>Source charge ID</label>
          <input
            id={`${id}-charge`}
            value={state.sourceChargeId}
            onChange={(event) => state.setSourceChargeId(event.target.value)}
          />
          <label htmlFor={`${id}-reversal`}>Partial reversal amount</label>
          <input
            id={`${id}-reversal`}
            type="number"
            min="0.01"
            step="0.01"
            value={state.reversalAmount}
            onChange={(event) => state.setReversalAmount(event.target.value)}
          />
          <button
            type="button"
            disabled={state.isPending}
            onClick={() => {
              void state.submitReversal("full");
            }}
          >
            Reverse all transfers
          </button>
          <button
            type="button"
            disabled={state.isPending}
            onClick={() => {
              void state.submitReversal("partial");
            }}
          >
            Partial reversal
          </button>
          {state.reversalResult && (
            <p role="status">
              Reversed {state.reversalResult.summary.reversalCount} transfers.
            </p>
          )}
        </>
      )}
    </section>
  );
}
