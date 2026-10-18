import { formatPayoutAmount } from "@fantastic.dev/better-stripe/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
type Outcome = {
  status: string;
  invoiceId?: string;
  currency?: string;
  amountPaid?: number;
  reason?: string;
  revenue?: Array<{
    routing?: string;
    purchaseId?: string;
    cash: {
      status: string;
      value?: {
        paymentIntentId?: string;
        gross: number;
        processingFee: number;
        currency: string;
      };
    };
    settlement?: {
      status: string;
      executedTransfers?: Array<{
        stripeTransferId: string;
        role: string;
        amount: number;
      }>;
    } | null;
  }>;
  renewal?: {
    period: { start: number; end: number };
    allowance?: {
      consumedQuantity: string;
      remainingIncludedQuantity: string;
    } | null;
  } | null;
};
export function MeteredBillingOutcome({
  json,
  prepaid,
}: {
  json?: string;
  prepaid: boolean;
}) {
  const value = json ? (JSON.parse(json) as Outcome) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing outcome</CardTitle>
        <CardDescription>
          Finalized invoices, verified cash and recipient transfers have
          separate evidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {!value ? (
            <p>
              No finalized invoice observed. Estimates are not collected cash.
            </p>
          ) : (
            <>
              <p>Native billing status: {value.status}</p>
              {value.reason && (
                <p role="status">Reconciliation required: {value.reason}</p>
              )}
              {value.invoiceId && (
                <p className="text-xs text-muted-foreground">
                  Original invoice {value.invoiceId}
                </p>
              )}
              {value.currency && value.amountPaid !== undefined && (
                <p>
                  Invoice cash paid:{" "}
                  {formatPayoutAmount(value.amountPaid, value.currency)}
                </p>
              )}
              {prepaid && (
                <p>
                  The original credit purchase is the cash source. Usage
                  consumes credits without a second payment.
                </p>
              )}
              {value.revenue?.map((row) => (
                <div
                  key={
                    row.purchaseId ??
                    row.cash.value?.paymentIntentId ??
                    value.invoiceId ??
                    row.routing ??
                    "unavailable"
                  }
                  className="space-y-1 rounded-md border p-3"
                >
                  <p>Original cash verification: {row.cash.status}</p>
                  {row.cash.status === "ready" && row.cash.value && (
                    <>
                      <p>
                        Captured:{" "}
                        {formatPayoutAmount(
                          row.cash.value.gross,
                          row.cash.value.currency,
                        )}
                      </p>
                      <p>
                        Actual processing fee:{" "}
                        {formatPayoutAmount(
                          row.cash.value.processingFee,
                          row.cash.value.currency,
                        )}
                      </p>
                    </>
                  )}
                  <p>
                    {row.settlement
                      ? `Settlement: ${row.settlement.status}`
                      : row.routing === "direct_issuer"
                        ? "Revenue retained by the issuer."
                        : "Settlement has not been verified."}
                  </p>
                  {row.settlement?.executedTransfers?.map((leg) => (
                    <p key={leg.stripeTransferId}>
                      Verified {leg.role} transfer:{" "}
                      {formatPayoutAmount(leg.amount, row.cash.value!.currency)}
                    </p>
                  ))}
                </div>
              ))}
              {value.renewal && (
                <div className="space-y-1">
                  <p>
                    Renewal period:{" "}
                    {new Date(value.renewal.period.start * 1000)
                      .toISOString()
                      .slice(0, 10)}{" "}
                    to{" "}
                    {new Date(value.renewal.period.end * 1000)
                      .toISOString()
                      .slice(0, 10)}
                  </p>
                  {!prepaid && !value.renewal.allowance && (
                    <p>
                      Renewal allowance is unavailable until the period is
                      active on the server.
                    </p>
                  )}
                  {value.renewal.allowance && (
                    <p>
                      New period consumed:{" "}
                      {value.renewal.allowance.consumedQuantity}. Included units
                      remaining:{" "}
                      {value.renewal.allowance.remainingIncludedQuantity}.
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Test clock renewal is read-only until event times enter the
                    real provider acceptance window.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
