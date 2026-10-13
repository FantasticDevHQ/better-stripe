import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useRole } from "@/providers/role-context";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  PayoutHistory,
  Payouts as BetterStripePayouts,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type PayoutData = FunctionReturnType<typeof api.recipientPayouts.load>;
type Payout = PayoutData["payouts"][number];
const currency = (amount: number, code: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
    amount / 100,
  );
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const date = (time: number | null) =>
  time === null ? "Not supplied by Stripe" : dateFormatter.format(time);

function PayoutTable({ payouts, empty }: { payouts: Payout[]; empty: string }) {
  return (
    <PayoutHistory rows={payouts} emptyLabel={empty}>
      {({ rows, isEmpty }) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payout ID</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Arrival date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell variant="identifier" density="compact">
                  {payout.id}
                </TableCell>
                <TableCell variant="amount">
                  {currency(payout.amount, payout.currency)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      payout.status === "failed"
                        ? "destructive"
                        : payout.status === "paid"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {payout.status.replaceAll("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>{date(payout.arrivalDate)}</TableCell>
              </TableRow>
            ))}
            {isEmpty && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  size="empty"
                  tone="muted"
                  className="text-center"
                >
                  <EmptyState>{empty}</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </PayoutHistory>
  );
}

function AccountPayouts({ userId }: { userId: Id<"users"> }) {
  const load = useAction(api.recipientPayouts.load);
  return (
    <BetterStripePayouts
      scopeKey={userId}
      load={(cursor) => load({ userId, cursor })}
    >
      {({
        data,
        error,
        isPending: busy,
        refresh,
        loadMore,
        nextPayout,
        upcomingPayouts,
        previousPayouts,
      }) => (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Payouts</h1>
              <p className="mt-2 text-muted-foreground">
                Your Stripe balance, upcoming payouts, and previous payouts to
                your bank account.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {busy ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!data ? (
            !error && <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {(["available", "pending"] as const).map((kind) => (
                  <Card key={kind}>
                    <CardHeader>
                      <CardTitle variant="metric">
                        {kind === "available" ? "Available" : "Pending"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(data.balances.length
                        ? data.balances
                        : [{ currency: "usd", available: 0, pending: 0 }]
                      ).map((balance) => (
                        <p
                          key={balance.currency}
                          className="text-2xl font-semibold tabular-nums"
                        >
                          {currency(balance[kind], balance.currency)}
                        </p>
                      ))}
                      <p className="mt-2 text-sm text-muted-foreground">
                        {kind === "available"
                          ? "Ready for payout"
                          : "Funds still settling"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
                <Card>
                  <CardHeader>
                    <CardTitle variant="metric">Next payout</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {nextPayout
                        ? currency(nextPayout.amount, nextPayout.currency)
                        : "Not scheduled"}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {nextPayout
                        ? `Expected arrival: ${date(nextPayout.arrivalDate)}`
                        : "Amount and arrival date appear when Stripe creates a payout."}
                    </p>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Upcoming payouts</CardTitle>
                </CardHeader>
                <CardContent>
                  <PayoutTable
                    payouts={upcomingPayouts}
                    empty="No upcoming payouts scheduled."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Previous payouts</CardTitle>
                </CardHeader>
                <CardContent>
                  <PayoutTable
                    payouts={previousPayouts}
                    empty="No previous payouts yet."
                  />
                  {data.nextCursor && (
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => void loadMore()}
                      disabled={busy}
                    >
                      {busy ? "Loading…" : "Load more payouts"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </BetterStripePayouts>
  );
}

export function Payouts() {
  const { currentUser } = useRole();
  if (!currentUser.stripeAccountId)
    return (
      <Alert>
        <AlertDescription>
          Your Stripe account has not been set up. Open Admin → Setup to finish
          seeding.
        </AlertDescription>
      </Alert>
    );
  return (
    <AccountPayouts
      key={currentUser.id}
      userId={currentUser.id as Id<"users">}
    />
  );
}
