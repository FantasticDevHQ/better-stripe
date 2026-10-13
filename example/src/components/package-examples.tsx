import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  PriceCard,
  SubscriptionCard,
  EarningsSummary,
  PayoutSchedule,
  type RecipientBalance,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { useEarnings } from "@/lib/stripe-hooks";
import { EmptyState } from "@/components/empty-state";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function ProductComponents() {
  const { currentUser, currentRole } = useRole();
  const [selected, select] = useState<string>();
  const all = useQuery(
    api.queries.listProductsWithPrices,
    currentRole === "admin" ? {} : "skip",
  );
  const own = useQuery(
    api.queries.listProductsWithPricesByAccount,
    currentRole !== "admin" && currentUser.stripeAccountId
      ? { accountId: currentUser.stripeAccountId }
      : "skip",
  );
  const products = currentRole === "admin" ? all : own;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="text-sm text-muted-foreground">
        PriceCard renders the same catalog prices through the package's render
        prop. Create and edit products in Headless.
      </p>
      {!products ? (
        <p role="status">Loading products…</p>
      ) : !products.length ? (
        <EmptyState>No products yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.flatMap((product) =>
            product.prices.map((price) => (
              <PriceCard
                key={price.stripePriceId}
                price={price}
                productName={product.name}
                isSelected={selected === price.stripePriceId}
              >
                {({ formattedPrice, isSelected }) => (
                  <Card>
                    <CardHeader>
                      <CardTitle>{product.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <p className="text-2xl font-semibold">
                          {formattedPrice}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {price.active ? "Active" : "Archived"}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => select(price.stripePriceId)}
                        >
                          {isSelected ? "Selected" : "Select price"}
                        </Button>
                        {isSelected && (
                          <p
                            role="status"
                            className="break-all text-sm text-muted-foreground"
                          >
                            {price.stripePriceId}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </PriceCard>
            )),
          )}
        </div>
      )}
    </div>
  );
}
export function SubscriptionComponents() {
  const { currentUser, currentRole } = useRole();
  const own = useQuery(
    api.queries.listSubscriptionsByUser,
    currentRole === "customer" ? { userId: currentUser.id } : "skip",
  );
  const all = useQuery(
    api.queries.listSubscriptions,
    currentRole === "admin" ? {} : "skip",
  );
  const store = useQuery(
    api.storefront.listStoreSubscriptions,
    currentRole === "seller"
      ? { sellerId: currentUser.id as Id<"users"> }
      : "skip",
  );
  const rows =
    currentRole === "seller" ? store : currentRole === "admin" ? all : own;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Subscriptions</h1>
      <p className="text-sm text-muted-foreground">
        SubscriptionCard displays current Stripe subscription state. Use
        Headless for subscription actions.
      </p>
      {!rows ? (
        <p role="status">Loading subscriptions…</p>
      ) : !rows.length ? (
        <EmptyState>No subscriptions yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((subscription) => (
            <Card key={subscription.stripeSubscriptionId}>
              <CardHeader>
                <CardTitle className="break-all">
                  {subscription.stripeSubscriptionId}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SubscriptionCard subscription={subscription} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
export function EarningsComponents() {
  const { currentUser } = useRole();
  const earnings = useEarnings(currentUser.stripeAccountId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>EarningsSummary component</CardTitle>
      </CardHeader>
      <CardContent>
        <EarningsSummary {...earnings} />
      </CardContent>
    </Card>
  );
}
export function PayoutComponents() {
  const { currentUser } = useRole();
  return <PayoutComponentsBody key={currentUser.stripeAccountId} />;
}
function PayoutComponentsBody() {
  const { currentUser } = useRole();
  const earnings = useEarnings(currentUser.stripeAccountId);
  const load = useAction(api.actions.getAccountBalance);
  const [balance, setBalance] = useState<RecipientBalance | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let canceled = false;
    if (currentUser.stripeAccountId)
      void load({ stripeAccountId: currentUser.stripeAccountId })
        .then((rows) => {
          if (!canceled)
            setBalance(
              rows.find((row) => row.currency === "usd") ?? rows[0] ?? null,
            );
        })
        .catch((error: unknown) => {
          if (!canceled) setError(String(error));
        });
    return () => {
      canceled = true;
    };
  }, [currentUser.stripeAccountId, load]);
  if (!currentUser.stripeAccountId)
    return <EmptyState>Set up your Stripe account to see payouts.</EmptyState>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Payouts</h1>
      <Card>
        <CardHeader>
          <CardTitle>PayoutSchedule component</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <PayoutSchedule
              balance={balance}
              payouts={earnings.payouts}
              isLoading={earnings.isLoading || !balance}
            />
          )}
        </CardContent>
      </Card>
      <EarningsComponents />
    </div>
  );
}
export function HostedBillingExample() {
  const { currentUser, currentRole } = useRole();
  const customerPortal = useAction(api.actions.createBillingPortalSession);
  const storePortal = useAction(api.storePlanActions.manage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe hosted Billing Portal</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p>
            Manage subscriptions, invoices, and saved payment methods in
            Stripe's hosted portal. This opens a separate Stripe page; Connect
            has no embedded customer billing or product catalog component.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Portal unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            disabled={busy || !currentUser.stripeAccountId}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                const result =
                  currentRole === "seller"
                    ? await storePortal({
                        sellerId: currentUser.id as Id<"users">,
                        returnUrl: window.location.href,
                      })
                    : await customerPortal({
                        stripeAccountId: currentUser.stripeAccountId!,
                        returnUrl: window.location.href,
                      });
                window.location.assign(
                  typeof result === "string" ? result : result.url,
                );
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not open the portal.",
                );
                setBusy(false);
              }
            }}
          >
            {busy ? "Opening portal…" : "Open Stripe Billing Portal"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
