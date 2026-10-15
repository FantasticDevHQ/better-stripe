"use client";
import { useState, useId, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { Connect, type ConnectProps } from "./Connect.js";
import {
  getChargeCurrencyMetadata,
  parseChargeAmount,
} from "../../client/charge-currency.js";
export type RefundRequest = {
  stripePaymentIntentId: string;
  /** Original payment currency's provider units. Legacy name, not universal cents. */
  amountCents?: number;
  reason: "requested_by_customer";
};
export type ReversalRequest = {
  sourceChargeId: string;
  /** Original charge provider units. */ amountCents?: number;
};
export type RefundResult = { stripeRefundId: string };
export type ReversalResult = {
  reversals: { stripeTransferId: string; amount: number }[];
  summary: { reversalCount: number; totalReversed: number };
};
export type RefundActionsProps = {
  scopeKey: string;
  paymentIntentId?: string;
  sourceChargeId?: string;
  /** Verified currency for paymentIntentId. Omitted = legacy USD; null = unknown. */
  paymentCurrency?: string | null;
  /** Verified currency for sourceChargeId, independently of the refund payment. */
  sourceChargeCurrency?: string | null;
  issueRefund: (args: RefundRequest) => Promise<RefundResult>;
  reverseTransfers?: (args: ReversalRequest) => Promise<ReversalResult>;
};
/** Exact positive refund amount in the original charge currency's provider units. */
export function parseRefundAmount(
  value: string,
  currency: string,
): number | null {
  const amount = parseChargeAmount(value.trim(), currency);
  return amount !== null && amount > 0 ? amount : null;
}
/** Legacy USD-only parser. Use parseRefundAmount for original-currency inputs. */
export function parseAmountCents(value: string): number | null {
  return parseRefundAmount(value, "usd");
}
export function useRefunds(props: RefundActionsProps) {
  const paymentCurrency =
    props.paymentCurrency === undefined
      ? "usd"
      : (props.paymentCurrency?.toLowerCase() ?? null);
  const sourceChargeCurrency =
    props.sourceChargeCurrency === undefined
      ? "usd"
      : (props.sourceChargeCurrency?.toLowerCase() ?? null);
  const scope = JSON.stringify([
    props.scopeKey,
    props.paymentIntentId?.trim(),
    props.sourceChargeId?.trim(),
    paymentCurrency,
    sourceChargeCurrency,
  ]);
  const initial = {
    scope,
    paymentIntentId: props.paymentIntentId ?? "",
    sourceChargeId: props.sourceChargeId ?? "",
    refundAmount: "",
    reversalAmount: "",
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
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
      const currency =
        operation.type === "refund" ? paymentCurrency : sourceChargeCurrency;
      const boundId =
        operation.type === "refund"
          ? props.paymentIntentId
          : props.sourceChargeId;
      const hasExplicitCurrency =
        operation.type === "refund"
          ? props.paymentCurrency !== undefined
          : props.sourceChargeCurrency !== undefined;
      if (
        operation.kind === "partial" &&
        hasExplicitCurrency &&
        id !== boundId?.trim()
      )
        throw new Error(
          "Original currency is not verified for this identifier.",
        );
      const amount =
        operation.kind === "partial"
          ? parseRefundAmount(
              operation.type === "refund"
                ? fields.refundAmount
                : fields.reversalAmount,
              currency ?? "",
            )
          : undefined;
      if (amount === null)
        throw new Error(
          `Enter a positive partial ${operation.type === "refund" ? "refund" : "reversal"} amount in supported original currency units.`,
        );
      if (operation.type === "refund")
        return {
          type: "refund" as const,
          value: await props.issueRefund({
            stripePaymentIntentId: id,
            ...(amount === undefined ? {} : { amountCents: amount }),
            reason: "requested_by_customer",
          }),
        };
      if (!props.reverseTransfers)
        throw new Error("Transfer reversals are not configured.");
      return {
        type: "reversal" as const,
        value: await props.reverseTransfers({
          sourceChargeId: id,
          ...(amount === undefined ? {} : { amountCents: amount }),
        }),
      };
    },
    JSON.stringify([
      scope,
      fields.paymentIntentId.trim(),
      fields.sourceChargeId.trim(),
    ]),
  );
  const set = (
    name:
      "paymentIntentId" | "sourceChargeId" | "refundAmount" | "reversalAmount",
    value: string,
  ) => setFields((previous) => ({ ...previous, [name]: value }));
  return {
    ...fields,
    scope: props.scopeKey,
    paymentCurrency,
    sourceChargeCurrency,
    refundInputDecimalPlaces:
      getChargeCurrencyMetadata(paymentCurrency ?? "")?.displayDecimals ?? null,
    reversalInputDecimalPlaces:
      getChargeCurrencyMetadata(sourceChargeCurrency ?? "")?.displayDecimals ??
      null,
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
function RefundAmountInput(props: {
  id: string;
  label: string;
  currency: string | null | undefined;
  decimalPlaces: number | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const step = props.decimalPlaces === 0 ? "1" : "0.01";
  return (
    <>
      <label htmlFor={props.id}>
        {props.label}
        {props.currency !== undefined
          ? ` (${props.currency?.toUpperCase() ?? "currency unavailable"})`
          : ""}
      </label>
      <input
        id={props.id}
        type="number"
        min={step}
        step={step}
        inputMode={props.decimalPlaces === 0 ? "numeric" : "decimal"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </>
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
      <RefundAmountInput
        id={`${id}-amount`}
        label="Partial refund amount"
        currency={props.paymentCurrency}
        decimalPlaces={state.refundInputDecimalPlaces}
        value={state.refundAmount}
        onChange={state.setRefundAmount}
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
          <RefundAmountInput
            id={`${id}-reversal`}
            label="Partial reversal amount"
            currency={props.sourceChargeCurrency}
            decimalPlaces={state.reversalInputDecimalPlaces}
            value={state.reversalAmount}
            onChange={state.setReversalAmount}
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
