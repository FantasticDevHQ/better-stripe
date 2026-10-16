import { SellerCosts } from "@/components/seller-costs";
import { RefundPreviewSummary } from "@/components/refund-preview-summary";
import { useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  PaymentDetails,
  RefundHistory,
  useRefunds,
  formatPrice,
  formatRefundAmount,
  groupRefundPreview,
} from "@fantastic.dev/better-stripe/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/providers/role-context";
import { useAction, useQuery } from "convex/react";
import { RotateCcw, Undo2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function Figure({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export function SellerRefunds() {
  const { currentUser } = useRole();
  const account = useQuery(api.accounts.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const issueRefund = useAction(api.connect.actions.issueRefund);
  const reverseTransfers = useAction(api.connect.actions.reverseSaleTransfers);

  const [params] = useSearchParams();
  const selectionScope = JSON.stringify([
    params.get("payment_intent"),
    params.get("charge_id"),
  ]);
  const initialSelection = {
    scope: selectionScope,
    paymentIntentId: params.get("payment_intent") ?? "",
    sourceChargeId: params.get("charge_id") ?? "",
  };
  const [selection, setSelection] = useState(initialSelection);
  if (selection.scope !== selectionScope) setSelection(initialSelection);
  const payment = useQuery(
    api.connect.queries.getPaymentByStripeId,
    selection.paymentIntentId.trim()
      ? { stripePaymentIntentId: selection.paymentIntentId.trim() }
      : "skip",
  );
  const chargeContext = useQuery(
    api.connect.queries.getRefundChargeContext,
    selection.sourceChargeId.trim()
      ? {
          userId: currentUser.id,
          sourceChargeId: selection.sourceChargeId.trim(),
        }
      : "skip",
  );
  const setPaymentIntentId = (paymentIntentId: string) =>
    setSelection((previous) => ({ ...previous, paymentIntentId }));
  const setSourceChargeId = (sourceChargeId: string) =>
    setSelection((previous) => ({ ...previous, sourceChargeId }));
  const {
    paymentIntentId,
    paymentCurrency,
    sourceChargeCurrency,
    refundInputDecimalPlaces,
    reversalInputDecimalPlaces,
    refundAmount,
    setRefundAmount,
    sourceChargeId,
    reversalAmount,
    setReversalAmount,
    refundResult,
    reversalResult,
    error,
    busy,
    submitRefund,
    submitReversal,
  } = useRefunds({
    scopeKey: currentUser.id,
    paymentIntentId: selection.paymentIntentId,
    sourceChargeId: selection.sourceChargeId,
    paymentCurrency: payment?.currency ?? null,
    sourceChargeCurrency:
      chargeContext?.sourceChargeId === selection.sourceChargeId.trim()
        ? chargeContext.currency
        : null,
    issueRefund: (args) => issueRefund({ ...args, userId: currentUser.id }),
    reverseTransfers: (args) =>
      reverseTransfers({ ...args, userId: currentUser.id }),
  });

  const stripeAccountId = account?.stripeAccountId ?? undefined;
  const cleanPaymentIntentId = paymentIntentId.trim();
  const refundHistoryArgs = cleanPaymentIntentId
    ? {
        accountId: stripeAccountId,
        stripePaymentIntentId: cleanPaymentIntentId,
      }
    : { accountId: stripeAccountId };

  const refunds = useQuery(
    api.connect.queries.listRefunds,
    stripeAccountId ? refundHistoryArgs : "skip",
  );

  const refundPreview = useMemo(
    () => groupRefundPreview(refunds ?? []),
    [refunds],
  );

  if (account === undefined) {
    return (
      <div className="space-y-6" data-testid="refunds-page">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="refunds-page">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Refunds & reversals</h1>
        <p className="text-muted-foreground">
          Issue full or partial refunds for a sale, review refund history, and
          run a standalone transfer reversal when ops needs a manual clawback.
        </p>
      </div>

      <SellerCosts kind="refund" />

      {!stripeAccountId && (
        <Alert>
          <AlertTitle>No seller account linked</AlertTitle>
          <AlertDescription>
            Refunds can still be reviewed by PaymentIntent id, but seller-scoped
            live refunds need a seeded Stripe Connect account.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" data-testid="refunds-error">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-master-detail">
        <Card>
          <CardHeader>
            <CardTitle>Refund a payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="refund-payment-intent">
                    PaymentIntent id
                  </Label>
                  <Input
                    id="refund-payment-intent"
                    value={paymentIntentId}
                    onChange={(event) => setPaymentIntentId(event.target.value)}
                    placeholder="pi_..."
                    data-testid="refund-payment-intent-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refund-amount">
                    Partial amount (
                    {paymentCurrency?.toUpperCase() ?? "currency unavailable"})
                  </Label>
                  <Input
                    id="refund-amount"
                    value={refundAmount}
                    onChange={(event) => setRefundAmount(event.target.value)}
                    placeholder={
                      refundInputDecimalPlaces === 0 ? "25" : "25.00"
                    }
                    inputMode={
                      refundInputDecimalPlaces === 0 ? "numeric" : "decimal"
                    }
                    data-testid="refund-partial-amount-input"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void submitRefund("full")}
                  disabled={busy !== null}
                  data-testid="refund-full-button"
                >
                  <Undo2 data-icon="inline-start" className="size-4" />
                  Full refund
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void submitRefund("partial")}
                  disabled={busy !== null || refundInputDecimalPlaces === null}
                  data-testid="refund-partial-button"
                >
                  <Undo2 data-icon="inline-start" className="size-4" />
                  Partial refund
                </Button>
              </div>

              {refundResult && (
                <Alert data-testid="refund-result">
                  <AlertTitle>Refund created</AlertTitle>
                  <AlertDescription>
                    Stripe refund id:{" "}
                    <span className="font-mono">
                      {refundResult.stripeRefundId}
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {cleanPaymentIntentId && payment === undefined ? (
                <Skeleton className="h-20 w-full" />
              ) : payment ? (
                <PaymentDetails payment={payment}>
                  {({ metrics }) => (
                    <div className="grid grid-cols-2 gap-4">
                      {metrics.map((metric) => (
                        <Figure
                          key={metric.key}
                          label={metric.label}
                          value={metric.value}
                          testId={
                            metric.key === "charged"
                              ? "refund-payment-amount"
                              : metric.key === "refunded"
                                ? "refund-payment-refunded"
                                : metric.key === "status"
                                  ? "refund-payment-status"
                                  : "refund-payment-refund-status"
                          }
                        />
                      ))}
                    </div>
                  )}
                </PaymentDetails>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Enter a PaymentIntent id to inspect its recorded refund state.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Refund history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Up to 25 loaded rows; older refunds may be excluded. Amounts are
              grouped by currency and provider status. Pending, failed and
              canceled requests are not completed refunds. This preview is not
              an account total.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Figure
                label="Loaded rows"
                value={refunds === undefined ? "..." : String(refunds.length)}
                testId="refund-history-count"
              />
              <Figure
                label="Scope"
                value={
                  cleanPaymentIntentId ? "Payment preview" : "Account preview"
                }
                testId="refund-history-scope"
              />
            </div>
            <RefundPreviewSummary
              groups={refundPreview}
              isLoading={refunds === undefined}
            />

            <RefundHistory rows={refunds}>
              {({ rows, isLoading, isEmpty }) =>
                isLoading ? (
                  <div role="status" aria-label="Loading refund history">
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : isEmpty ? (
                  <Alert data-testid="refund-history-empty">
                    <AlertTitle>No data yet</AlertTitle>
                    <AlertDescription>
                      No refunds are recorded. Issue a refund or enter a
                      PaymentIntent with refund webhooks to see history here.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Table data-testid="refunds-history">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Refund</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((refund) => (
                        <TableRow key={refund.stripeRefundId}>
                          <TableCell variant="identifier">
                            {refund.stripeRefundId}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{refund.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {formatRefundAmount(
                              refund.amount,
                              refund.currency,
                            ) ?? "Amount unavailable"}
                          </TableCell>
                          <TableCell>{refund.reason ?? "unknown"}</TableCell>
                          <TableCell>
                            {refund._creationTime === undefined
                              ? "Unknown"
                              : formatDate(refund._creationTime)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              }
            </RefundHistory>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standalone transfer reversal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Partial reversals use the original charge currency, verified
              against this seller's stored merchant allocation. They remain
              disabled when that context is unavailable.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reversal-source-charge">Source charge id</Label>
                <Input
                  id="reversal-source-charge"
                  value={sourceChargeId}
                  onChange={(event) => setSourceChargeId(event.target.value)}
                  placeholder="ch_..."
                  data-testid="reversal-charge-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reversal-amount">
                  Partial amount (
                  {sourceChargeCurrency?.toUpperCase() ??
                    "currency unavailable"}
                  )
                </Label>
                <Input
                  id="reversal-amount"
                  value={reversalAmount}
                  onChange={(event) => setReversalAmount(event.target.value)}
                  placeholder={
                    reversalInputDecimalPlaces === 0 ? "10" : "10.00"
                  }
                  inputMode={
                    reversalInputDecimalPlaces === 0 ? "numeric" : "decimal"
                  }
                  data-testid="reversal-partial-amount-input"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void submitReversal("full")}
                disabled={busy !== null}
                data-testid="reversal-full-button"
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                Full reversal
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void submitReversal("partial")}
                disabled={busy !== null || reversalInputDecimalPlaces === null}
                data-testid="reversal-partial-button"
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                Partial reversal
              </Button>
            </div>

            {reversalResult && (
              <Alert data-testid="reversal-result">
                <AlertTitle>Reversal complete</AlertTitle>
                <AlertDescription>
                  {reversalResult.summary.reversalCount} transfer(s),{" "}
                  {sourceChargeCurrency && reversalInputDecimalPlaces !== null
                    ? formatPrice(
                        reversalResult.summary.totalReversed,
                        sourceChargeCurrency,
                      )
                    : "Amount unavailable"}{" "}
                  reversed.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
