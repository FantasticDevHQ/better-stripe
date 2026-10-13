"use client";
import type { CollectionProps, WorkflowColumn } from "./Collection.js";
import { Collection } from "./Collection.js";
import { formatPrice } from "../lib/price-helpers.js";
export type ResourceCollectionProps<Row> = Omit<
  CollectionProps<Row>,
  "columns" | "getKey"
> & { columns?: WorkflowColumn<Row>[] };
export type SaleRow = {
  _id?: string;
  planId: string;
  paymentIntentId: string;
  chargeId?: string;
  gross: number;
  processingFee: number;
  platformNet: number;
  affiliateNet: number;
  costRecoveryAmount?: number;
  sellerNet: number;
  currency: string;
  status: string;
};
export function Sales(props: ResourceCollectionProps<SaleRow>) {
  const columns: WorkflowColumn<SaleRow>[] = [
    { id: "planId", label: "Plan", cell: (row) => row.planId },
    ...(
      [
        ["gross", "Sale"],
        ["processingFee", "Stripe processing"],
        ["platformNet", "Platform"],
        ["affiliateNet", "Affiliate"],
        ["costRecoveryAmount", "Cost recovery"],
        ["sellerNet", "Your earnings"],
      ] as const
    ).map(([field, label]) => ({
      id: field,
      label,
      align: "end" as const,
      cell: (row: SaleRow) => formatPrice(row[field] ?? 0, row.currency),
    })),
    { id: "status", label: "Status", cell: (row) => row.status },
    { id: "payment", label: "Payment", cell: (row) => row.paymentIntentId },
  ];
  return (
    <Collection
      emptyLabel="No sales yet."
      {...props}
      getKey={(row) => row._id ?? row.paymentIntentId}
      columns={props.columns ?? columns}
    />
  );
}
export type InvoiceRow = {
  stripeInvoiceId: string;
  amountPaid?: number;
  amountDue?: number;
  currency: string;
  status: string;
  hostedInvoiceUrl?: string;
};
export function Invoices(props: ResourceCollectionProps<InvoiceRow>) {
  const columns: WorkflowColumn<InvoiceRow>[] = [
    { id: "id", label: "Invoice ID", cell: (row) => row.stripeInvoiceId },
    {
      id: "amount",
      label: "Amount",
      align: "end",
      cell: (row) =>
        formatPrice(row.amountPaid ?? row.amountDue ?? 0, row.currency),
    },
    { id: "status", label: "Status", cell: (row) => row.status },
    {
      id: "invoice",
      label: "Invoice",
      cell: (row) =>
        row.hostedInvoiceUrl ? (
          <a
            href={row.hostedInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View invoice
          </a>
        ) : (
          "Unavailable"
        ),
    },
  ];
  return (
    <Collection
      emptyLabel="No invoices yet."
      {...props}
      getKey={(row) => row.stripeInvoiceId}
      columns={props.columns ?? columns}
    />
  );
}
export type RefundRow = {
  /** Unix milliseconds, matching Convex creation timestamps. */
  _creationTime?: number;
  stripeRefundId: string;
  amount: number;
  currency: string;
  status: string;
  reason?: string;
};
export function RefundHistory(props: ResourceCollectionProps<RefundRow>) {
  const columns: WorkflowColumn<RefundRow>[] = [
    { id: "id", label: "Refund ID", cell: (row) => row.stripeRefundId },
    {
      id: "amount",
      label: "Amount",
      align: "end",
      cell: (row) => formatPrice(row.amount, row.currency),
    },
    { id: "status", label: "Status", cell: (row) => row.status },
    {
      id: "reason",
      label: "Reason",
      cell: (row) => row.reason ?? "Not supplied",
    },
    {
      id: "created",
      label: "Created",
      cell: (row) =>
        row._creationTime === undefined
          ? "Not supplied"
          : new Date(row._creationTime).toLocaleString(),
    },
  ];
  return (
    <Collection
      emptyLabel="No refunds yet."
      {...props}
      getKey={(row) => row.stripeRefundId}
      columns={props.columns ?? columns}
    />
  );
}
export type ReferredSaleRow = {
  stripeTransferId: string;
  sourceChargeId?: string;
  storeName?: string | null;
  amount: number;
  currency?: string;
};
export function ReferredSales(props: ResourceCollectionProps<ReferredSaleRow>) {
  const columns: WorkflowColumn<ReferredSaleRow>[] = [
    {
      id: "store",
      label: "Store",
      cell: (row) => row.storeName ?? "Store unavailable",
    },
    {
      id: "payment",
      label: "Payment",
      cell: (row) => row.sourceChargeId ?? row.stripeTransferId,
    },
    {
      id: "commission",
      label: "Commission",
      align: "end",
      cell: (row) => formatPrice(row.amount, row.currency ?? "usd"),
    },
  ];
  return (
    <Collection
      emptyLabel="No referred sales yet."
      {...props}
      getKey={(row) => row.stripeTransferId}
      columns={props.columns ?? columns}
    />
  );
}
export type WebhookEventRow = {
  stripeEventId: string;
  eventType: string;
  status: string;
  processedAt?: number;
  lastError?: string;
  livemode?: boolean;
};
export function WebhookEvents(props: ResourceCollectionProps<WebhookEventRow>) {
  const columns: WorkflowColumn<WebhookEventRow>[] = [
    { id: "type", label: "Type", cell: (row) => row.eventType },
    { id: "status", label: "Status", cell: (row) => row.status },
    { id: "id", label: "Event ID", cell: (row) => row.stripeEventId },
    { id: "error", label: "Error", cell: (row) => row.lastError ?? "None" },
    {
      id: "processed",
      label: "Processed",
      cell: (row) =>
        row.processedAt === undefined
          ? "Not supplied"
          : new Date(row.processedAt).toLocaleString(),
    },
    {
      id: "mode",
      label: "Mode",
      cell: (row) => (row.livemode ? "Live" : "Test"),
    },
  ];
  return (
    <Collection
      emptyLabel="No webhook events yet."
      {...props}
      getKey={(row) => row.stripeEventId}
      columns={props.columns ?? columns}
    />
  );
}
