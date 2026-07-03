import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmbeddedCheckout } from "@getdojo/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

function formatCurrency(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function StoreCheckoutForm({
  userId,
  stripePriceId,
  destinationAccountId,
  publishableKey,
}: {
  userId: string;
  stripePriceId: string;
  destinationAccountId: string;
  publishableKey: string;
}) {
  const createCheckout = useAction(
    api.marketplace.createStoreSubscriptionCheckout,
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasInitiated = useRef(false);

  const initCheckout = useCallback(async () => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;
    try {
      const session = await createCheckout({
        userId,
        stripePriceId,
        destinationAccountId,
        returnUrl:
          window.location.origin +
          "/checkout/status?session_id={CHECKOUT_SESSION_ID}",
      });
      if (session?.clientSecret) {
        setClientSecret(session.clientSecret);
      } else {
        setError("Failed to create checkout session. No client secret returned.");
      }
    } catch (err) {
      console.error("Store subscription checkout error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create checkout session.",
      );
    }
  }, [createCheckout, userId, stripePriceId, destinationAccountId]);

  // Kick off session creation once on mount; the ref guard keeps it idempotent
  // under StrictMode's double-invoked effects (mirrors the base Checkout page).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: creates the checkout session on mount
    void initCheckout();
  }, [initCheckout]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Checkout Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!clientSecret) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <EmbeddedCheckout
      publishableKey={publishableKey}
      clientSecret={clientSecret}
      onComplete={() => {
        window.location.href = "/demo/store-earnings";
      }}
    />
  );
}

/**
 * BTS-42 buyer flow: subscribe to a seeded store's recurring plan as a
 * destination charge (funds route to the seller, platform keeps a 10% fee).
 */
export function StoreSubscribe() {
  const context = useQuery(api.marketplace.getMarketplaceDemoContext);
  const publishableKey = useQuery(api.queries.getPublishableKey);

  if (context === undefined || !publishableKey) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (context === null) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <Alert>
          <AlertTitle>Marketplace demo not seeded</AlertTitle>
          <AlertDescription>
            Run the marketplace seed (with a live Stripe key) to create the
            buyer, store, and catalog:{" "}
            <code className="bg-muted rounded px-1">
              pnpm --filter ./example run setup
            </code>
            .
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { buyer, store, price, feePercent } = context;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Subscribe to {store.storeName}</h1>
        <p className="text-muted-foreground">
          {buyer.name} is subscribing to {store.storeName}'s recurring plan. This
          is a real destination charge — funds route to the seller and the
          platform keeps its fee.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-1 p-6">
          <div className="flex justify-between">
            <span>Plan price</span>
            <span className="font-medium">
              {formatCurrency(price.unitAmount, price.currency)}
              {price.interval ? ` / ${price.interval}` : ""}
            </span>
          </div>
          <div className="text-muted-foreground flex justify-between text-sm">
            <span>Platform fee</span>
            <span>{feePercent}% application fee</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <StoreCheckoutForm
            userId={buyer.id}
            stripePriceId={price.stripePriceId}
            destinationAccountId={store.stripeAccountId}
            publishableKey={publishableKey}
          />
        </CardContent>
      </Card>

      <Button variant="ghost" size="sm" render={<Link to="/demo/store-earnings" />}>
        Skip to store earnings
        <ArrowRight className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}
