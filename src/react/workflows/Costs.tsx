"use client";
import type { ReactNode } from "react";
import { Collection, type WorkflowColumn } from "./Collection.js";
import type { ResourceCollectionProps } from "./Collections.js";
import { formatPrice } from "../lib/price-helpers.js";
export type CostRecoveryRow = {
  _id?: string;
  id?: string;
  paymentIntentId: string;
  amountDue: number;
  collectedAmount: number;
  invoicedAmount: number;
  outstanding: number;
  currency: string;
};
export function CostRecovery(props: ResourceCollectionProps<CostRecoveryRow>) {
  const columns: WorkflowColumn<CostRecoveryRow>[] = [
    { id: "payment", label: "Payment", cell: (row) => row.paymentIntentId },
    ...(
      [
        ["amountDue", "Total cost"],
        ["collectedAmount", "Deducted from earnings"],
        ["invoicedAmount", "Added to invoice"],
        ["outstanding", "Outstanding"],
      ] as const
    ).map(([field, label]) => ({
      id: field,
      label,
      align: "end" as const,
      cell: (row: CostRecoveryRow) => formatPrice(row[field], row.currency),
    })),
  ];
  return (
    <Collection
      emptyLabel="No costs yet."
      loadingLabel="Loading costs…"
      {...props}
      columns={props.columns ?? columns}
      getKey={(row) => row._id ?? row.id ?? row.paymentIntentId}
    />
  );
}
export type ChargebackTransfer = {
  stripeTransferId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  role?: string;
  reversedAmount?: number;
  reversalStatus?: string;
};
export type ChargebackSummary = {
  dispute: { stripeChargeId?: string; currency: string; status: string };
  transfers: ChargebackTransfer[];
  gross: number;
  reversed: number;
  net: number;
};
export type ChargebackLedgerRenderProps = {
  data: ChargebackSummary | null | undefined;
  isLoading: boolean;
  isEmpty: boolean;
  grossLabel: string;
  reversedLabel: string;
  netLabel: string;
  columns: WorkflowColumn<ChargebackTransfer>[];
};
export function ChargebackLedger({
  chargeback,
  children,
}: {
  chargeback: ChargebackSummary | null | undefined;
  children?: (state: ChargebackLedgerRenderProps) => ReactNode;
}) {
  const currency = chargeback?.dispute.currency ?? "usd";
  const columns: WorkflowColumn<ChargebackTransfer>[] = [
    { id: "transfer", label: "Transfer", cell: (row) => row.stripeTransferId },
    {
      id: "account",
      label: "Recipient",
      cell: (row) => row.destinationAccountId,
    },
    {
      id: "amount",
      label: "Amount",
      align: "end",
      cell: (row) => formatPrice(row.amount, row.currency),
    },
    {
      id: "reversed",
      label: "Reversed",
      align: "end",
      cell: (row) => formatPrice(row.reversedAmount ?? 0, row.currency),
    },
    {
      id: "status",
      label: "Status",
      cell: (row) => row.reversalStatus ?? "Not reversed",
    },
  ];
  const state: ChargebackLedgerRenderProps = {
    data: chargeback,
    isLoading: chargeback === undefined,
    isEmpty: chargeback === null || !chargeback?.dispute.stripeChargeId,
    grossLabel: formatPrice(chargeback?.gross ?? 0, currency),
    reversedLabel: formatPrice(-(chargeback?.reversed ?? 0), currency),
    netLabel: formatPrice(chargeback?.net ?? 0, currency),
    columns,
  };
  if (children) return <>{children(state)}</>;
  if (state.isLoading)
    return <p role="status">Loading chargeback transfers…</p>;
  if (state.isEmpty) return <p>No linked charge is available yet.</p>;
  return (
    <section data-better-stripe="chargeback-ledger">
      <h3>Chargeback transfers</h3>
      <dl>
        <dt>Original transfers</dt>
        <dd>{state.grossLabel}</dd>
        <dt>Funds pulled back</dt>
        <dd>{state.reversedLabel}</dd>
        <dt>Recipient net</dt>
        <dd>{state.netLabel}</dd>
      </dl>
      <Collection
        rows={chargeback!.transfers}
        columns={columns}
        getKey={(row) => row.stripeTransferId}
        emptyLabel="No transfer rows found."
      />
    </section>
  );
}
