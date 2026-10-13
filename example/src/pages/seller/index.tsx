import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  PayoutOverview,
  AccountCreateCard,
  ConnectStatusBadge,
  type StripeComponentPayout,
} from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function SellerHome() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const payouts = useQuery(
    api.queries.listPayoutsByAccount,
    account?.stripeAccountId ? { accountId: account.stripeAccountId } : "skip",
  ) as StripeComponentPayout[] | undefined;

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent padding="lg">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-32" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // State: no Connect account yet
  if (account === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Seller Earnings</h1>
        <p className="text-muted-foreground">
          Connect a Stripe account to start receiving payouts.
        </p>
        <AccountCreateCard />
      </div>
    );
  }

  // State: account exists but onboarding incomplete
  const onboardingStatus = account.onboardingStatus ?? "pending";
  if (onboardingStatus !== "complete") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Seller Earnings</h1>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground">Account status:</p>
          <ConnectStatusBadge status={onboardingStatus} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Complete Onboarding</CardTitle>
            <CardDescription>
              Your Stripe account needs additional information before you can
              receive payouts. Visit the{" "}
              <a href="/seller/onboarding" className="text-primary underline">
                onboarding page
              </a>{" "}
              to continue.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // State: fully onboarded — show earnings overview
  return (
    <PayoutOverview payouts={payouts} currency="usd">
      {({ metrics, recentPayouts }) => (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Seller Earnings</h1>
            <ConnectStatusBadge status="complete" />
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {metrics.map((stat) => (
              <Card key={stat.label}>
                <CardHeader spacing="compact">
                  <CardDescription>{stat.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  {payouts === undefined ? (
                    <Skeleton className="h-8 w-24" />
                  ) : (
                    <p className="text-2xl font-bold">{stat.value}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recent payouts */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Payouts</CardTitle>
            </CardHeader>
            <CardContent>
              {payouts === undefined ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : recentPayouts.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No data yet. Payouts will appear after earnings are
                    released.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-1">
                  {recentPayouts.map((payout, i) => (
                    <div key={payout._id}>
                      <div className="flex items-center justify-between py-2">
                        <span className="text-muted-foreground text-sm">
                          {payout.arrivalDate
                            ? new Date(payout.arrivalDate).toLocaleDateString()
                            : "\u2014"}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(payout.amount ?? 0)}
                        </span>
                        <Badge variant="default">{payout.status}</Badge>
                      </div>
                      {i < recentPayouts.length - 1 && <Separator />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PayoutOverview>
  );
}
