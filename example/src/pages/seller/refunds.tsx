import { useMemo, useState } from "react";

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

function formatCurrency(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function parseCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
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

type RefundResult = { stripeRefundId: string };
type ReversalResult = {
  reversals: { stripeTransferId: string; amount: number }[];
  summary: { reversalCount: number; totalReversed: number };
};

export function SellerRefunds() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const issueRefund = useAction(api.actions.issueRefund);
  const reverseTransfers = useAction(api.actions.reverseSaleTransfers);

  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [sourceChargeId, setSourceChargeId] = useState("");
  const [reversalAmount, setReversalAmount] = useState("");
  const [refundResult, setRefundResult] = useState<RefundResult | null>(null);
  const [reversalResult, setReversalResult] = useState<ReversalResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refund" | "reversal" | null>(null);

  const stripeAccountId = account?.stripeAccountId ?? undefined;
  const cleanPaymentIntentId = paymentIntentId.trim();
  const cleanSourceChargeId = sourceChargeId.trim();
  const refundHistoryArgs = cleanPaymentIntentId
    ? { stripePaymentIntentId: cleanPaymentIntentId }
    : {};

  const payment = useQuery(
    api.queries.getPaymentByStripeId,
    cleanPaymentIntentId
      ? { stripePaymentIntentId: cleanPaymentIntentId }
      : "skip",
  );
  const refunds = useQuery(
    api.queries.listRefunds,
    account === undefined ? "skip" : refundHistoryArgs,
  );

  const refundedTotal = useMemo(
    () => (refunds ?? []).reduce((sum, row) => sum + row.amount, 0),
    [refunds],
  );

  async function submitRefund(kind: "full" | "partial") {
    setError(null);
    setRefundResult(null);
    if (!cleanPaymentIntentId) {
      setError("Enter a PaymentIntent id before issuing a refund.");
      return;
    }

    const parsedAmountCents =
      kind === "partial" ? parseCents(refundAmount) : undefined;
    if (kind === "partial" && parsedAmountCents === null) {
      setError("Enter a positive partial refund amount.");
      return;
    }

    setBusy("refund");
    try {
      const result = await issueRefund({
        userId: currentUser.id,
        stripePaymentIntentId: cleanPaymentIntentId,
        amountCents: parsedAmountCents ?? undefined,
        reason: "requested_by_customer",
      });
      setRefundResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue refund.");
    } finally {
      setBusy(null);
    }
  }

  async function submitReversal(kind: "full" | "partial") {
    setError(null);
    setReversalResult(null);
    if (!cleanSourceChargeId) {
      setError("Enter a source charge id before reversing transfers.");
      return;
    }

    const parsedAmountCents =
      kind === "partial" ? parseCents(reversalAmount) : undefined;
    if (kind === "partial" && parsedAmountCents === null) {
      setError("Enter a positive partial reversal amount.");
      return;
    }

    setBusy("reversal");
    try {
      const result = await reverseTransfers({
        userId: currentUser.id,
        sourceChargeId: cleanSourceChargeId,
        amountCents: parsedAmountCents ?? undefined,
      });
      setReversalResult(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reverse transfers.",
      );
    } finally {
      setBusy(null);
    }
  }

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Refund a payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refund-payment-intent">PaymentIntent id</Label>
                <Input
                  id="refund-payment-intent"
                  value={paymentIntentId}
                  onChange={(event) => setPaymentIntentId(event.target.value)}
                  placeholder="pi_..."
                  data-testid="refund-payment-intent-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="refund-amount">Partial amount</Label>
                <Input
                  id="refund-amount"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  placeholder="25.00"
                  inputMode="decimal"
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
                <Undo2 className="size-4" />
                Full refund
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void submitRefund("partial")}
                disabled={busy !== null}
                data-testid="refund-partial-button"
              >
                <Undo2 className="size-4" />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cleanPaymentIntentId && payment === undefined ? (
              <Skeleton className="h-20 w-full" />
            ) : payment ? (
              <div className="grid grid-cols-2 gap-4">
                <Figure
                  label="Charged"
                  value={formatCurrency(payment.amount, payment.currency)}
                  testId="refund-payment-amount"
                />
                <Figure
                  label="Refunded"
                  value={formatCurrency(
                    payment.refundedAmount ?? 0,
                    payment.currency,
                  )}
                  testId="refund-payment-refunded"
                />
                <Figure
                  label="Status"
                  value={payment.status}
                  testId="refund-payment-status"
                />
                <Figure
                  label="Refund state"
                  value={payment.refundStatus ?? "none"}
                  testId="refund-payment-refund-status"
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Enter a PaymentIntent id to inspect its recorded refund state.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Refund history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Figure
              label="Rows"
              value={refunds === undefined ? "..." : String(refunds.length)}
              testId="refund-history-count"
            />
            <Figure
              label="Total"
              value={formatCurrency(refundedTotal)}
              testId="refund-history-total"
            />
            <Figure
              label="Scope"
              value={cleanPaymentIntentId ? "Payment" : "All refunds"}
              testId="refund-history-scope"
            />
          </div>

          {refunds === undefined ? (
            <Skeleton className="h-32 w-full" />
          ) : refunds.length === 0 ? (
            <Alert data-testid="refund-history-empty">
              <AlertTitle>No refunds recorded</AlertTitle>
              <AlertDescription>
                Issue a refund or enter a PaymentIntent with refund webhooks to
                see history here.
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
                {refunds.map((refund) => (
                  <TableRow key={refund.stripeRefundId}>
                    <TableCell className="font-mono">
                      {refund.stripeRefundId}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{refund.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {formatCurrency(refund.amount, refund.currency)}
                    </TableCell>
                    <TableCell>{refund.reason ?? "unknown"}</TableCell>
                    <TableCell>{formatDate(refund._creationTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standalone transfer reversal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
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
              <Label htmlFor="reversal-amount">Partial amount</Label>
              <Input
                id="reversal-amount"
                value={reversalAmount}
                onChange={(event) => setReversalAmount(event.target.value)}
                placeholder="10.00"
                inputMode="decimal"
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
              <RotateCcw className="size-4" />
              Full reversal
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void submitReversal("partial")}
              disabled={busy !== null}
              data-testid="reversal-partial-button"
            >
              <RotateCcw className="size-4" />
              Partial reversal
            </Button>
          </div>

          {reversalResult && (
            <Alert data-testid="reversal-result">
              <AlertTitle>Reversal complete</AlertTitle>
              <AlertDescription>
                {reversalResult.summary.reversalCount} transfer(s),{" "}
                {formatCurrency(reversalResult.summary.totalReversed)} reversed.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
