import { formatRefundAmount } from "@fantastic.dev/better-stripe/react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type InvoicePaymentOption = {
  id: string;
  paymentIntentId: string | null;
  referenceStatus: "payment_intent" | "unsupported" | "unavailable";
  amountPaid: number | null;
  currency: string;
  status: string;
};
export function InvoicePaymentSelector(props: {
  rows: InvoicePaymentOption[];
  isLoading: boolean;
  hasMore: boolean;
  error: boolean;
  onLoadMore: () => void;
  onSelect: (paymentIntentId: string) => void;
}) {
  return (
    <Card data-testid="invoice-payment-selector">
      <CardHeader>
        <CardTitle>Invoice payments</CardTitle>
        <CardDescription>
          Select a verified payment reference to review. The amount credited to
          this invoice is not its remaining refundable balance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {props.error ? (
            <p role="alert">Failed to read invoice payments</p>
          ) : props.isLoading ? (
            <p role="status">Loading invoice payments</p>
          ) : props.rows.length === 0 ? (
            <p>No invoice payments</p>
          ) : (
            <ul className="space-y-3">
              {props.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm break-all">{row.id}</p>
                    <p>
                      {row.status}:{" "}
                      {row.amountPaid === null
                        ? "Amount unavailable"
                        : (formatRefundAmount(row.amountPaid, row.currency) ??
                          "Amount unavailable")}
                    </p>
                    {row.referenceStatus !== "payment_intent" && (
                      <p className="text-muted-foreground text-sm">
                        {row.referenceStatus === "unsupported"
                          ? "Unsupported payment type"
                          : "Payment reference unavailable"}
                      </p>
                    )}
                  </div>
                  {row.referenceStatus === "payment_intent" &&
                    row.paymentIntentId && (
                      <Button
                        variant="outline"
                        aria-label={`Review payment ${row.paymentIntentId}`}
                        onClick={() => {
                          if (row.paymentIntentId)
                            props.onSelect(row.paymentIntentId);
                        }}
                      >
                        Review payment
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          )}
          {props.hasMore && !props.error && (
            <Button
              variant="outline"
              disabled={props.isLoading}
              onClick={props.onLoadMore}
            >
              Load more invoice payments
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
