import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  earningsFromBalance,
  type BalanceSnapshot,
} from "@/lib/store-earnings";
import {
  EarningsSummary,
  PayoutSchedule,
  type StripeComponentPayout,
} from "@getdojo/better-stripe/react";
import { useAction, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

function formatCurrency(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

/**
 * BTS-42 seller view: the store's balance + rolling payouts (PayoutSchedule),
 * earnings (EarningsSummary, derived from the balance snapshot since a
 * destination charge leaves no transfer-ledger row), and the platform fee on
 * the resulting invoice.
 */
export function StoreEarnings() {
  const context = useQuery(api.marketplace.getMarketplaceDemoContext);
  const getBalance = useAction(api.marketplace.getRecipientBalance);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);

  const accountId = context?.store.stripeAccountId;
  const payouts = useQuery(
    api.marketplace.listStorePayouts,
    accountId ? { stripeAccountId: accountId } : "skip",
  ) as StripeComponentPayout[] | undefined;
  const invoice = useQuery(
    api.marketplace.getLatestStoreInvoice,
    context ? { userId: context.buyer.id } : "skip",
  );

  // Fetch the connected account's live balance once the account id is known.
  // Balance comes from Stripe (an action), so it's fetched imperatively rather
  // than via a reactive query; a null result degrades to payouts-only.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void getBalance({ stripeAccountId: accountId }).then((snap) => {
      if (!cancelled) setBalance(snap);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, getBalance]);

  if (context === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (context === null) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <Alert>
          <AlertTitle>No data found</AlertTitle>
          <AlertDescription>
            The marketplace demo is not seeded. Run the marketplace seed (with a
            live Stripe key) to create the store and catalog:{" "}
            <code className="bg-muted rounded px-1">
              pnpm --filter ./example run setup
            </code>
            .
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { store } = context;
  const payoutRows = payouts ?? [];
  const earnings = earningsFromBalance(balance, payoutRows);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{store.storeName} — Earnings</h1>
        <p className="text-muted-foreground">
          Money from destination-charge subscriptions lands in the store's
          Stripe balance and pays out on a rolling schedule.
        </p>
      </div>

      {/* Earnings — the merged EarningsSummary, fed by the balance + payouts. */}
      <Card>
        <CardHeader>
          <CardTitle>Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          <EarningsSummary
            gross={earnings.gross}
            reversed={earnings.reversed}
            net={earnings.net}
            paidOut={earnings.paidOut}
            payouts={payoutRows}
            currency={earnings.currency}
            isLoading={payouts === undefined}
          >
            {({ grossLabel, netLabel, paidOutLabel, latestPayoutMessage }) => (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <Figure label="Gross" value={grossLabel} />
                  <Figure label="Net" value={netLabel} />
                  <Figure label="Paid out" value={paidOutLabel} />
                </div>
                <p className="text-muted-foreground text-sm">
                  {latestPayoutMessage}
                </p>
              </div>
            )}
          </EarningsSummary>
        </CardContent>
      </Card>

      {/* Balance + payout schedule — the merged PayoutSchedule. */}
      <Card>
        <CardHeader>
          <CardTitle>Balance &amp; payouts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <PayoutSchedule
            balance={balance}
            payouts={payoutRows}
            isLoading={payouts === undefined}
          >
            {({ availableLabel, pendingLabel, nextPayoutMessage }) => (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Figure label="Available" value={availableLabel} />
                  <Figure label="Pending" value={pendingLabel} />
                </div>
                <p className="text-muted-foreground text-sm">
                  {nextPayoutMessage}
                </p>
              </div>
            )}
          </PayoutSchedule>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payout ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Arrival</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutRows.map((payout) => (
                <TableRow key={payout._id}>
                  <TableCell className="font-mono text-xs">
                    {payout.stripePayoutId}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(
                      payout.amount ?? 0,
                      payout.currency || "usd",
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {payout.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {payout.arrivalDate
                      ? new Date(payout.arrivalDate).toLocaleDateString()
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {payoutRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-6">
                    No payouts yet — balance reflects funds awaiting the next
                    rolling payout.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Platform fee on the resulting invoice. */}
      <Card>
        <CardHeader>
          <CardTitle>Latest sale — platform fee</CardTitle>
        </CardHeader>
        <CardContent>
          {invoice === undefined ? (
            <Skeleton className="h-16 w-full" />
          ) : invoice === null ? (
            <p className="text-muted-foreground text-sm">
              No paid invoice yet. Complete the subscription checkout to see the
              charge and its platform fee.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <Figure
                label="Charged"
                value={formatCurrency(invoice.gross, invoice.currency)}
              />
              <Figure
                label={`Platform fee (${context.feePercent}%)`}
                value={formatCurrency(invoice.fee, invoice.currency)}
              />
              <Figure
                label="Seller net"
                value={formatCurrency(invoice.net, invoice.currency)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
