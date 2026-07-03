import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCheckoutReturnUrl } from "@/lib/checkout-return-url";
import { EmbeddedCheckout } from "@getdojo/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { CheckCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

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

function DestinationChargeCheckoutForm({
  userId,
  stripePriceId,
  destinationAccountId,
  amount,
  publishableKey,
}: {
  userId: string;
  stripePriceId: string;
  destinationAccountId: string;
  amount: number;
  publishableKey: string;
}) {
  const createCheckout = useAction(
    api.marketplace.createDestinationChargeCheckout,
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
        amount,
        // Returns to THIS page (not the generic /checkout/status) so the
        // fee/payout breakdown can be confirmed inline once Stripe redirects
        // back with the real session id (BTS-58, reusing the BTS-62 helper).
        returnUrl: buildCheckoutReturnUrl(
          window.location.origin,
          "/demo/destination-charge",
        ),
      });
      if (session?.clientSecret) {
        setClientSecret(session.clientSecret);
      } else {
        setError("Failed to create checkout session. No client secret returned.");
      }
    } catch (err) {
      console.error("Destination charge checkout error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create checkout session.",
      );
    }
  }, [createCheckout, userId, stripePriceId, destinationAccountId, amount]);

  // Kick off session creation once on mount; the ref guard keeps it
  // idempotent under StrictMode's double-invoked effects (mirrors the base
  // Checkout page). No `onComplete`: Stripe's own `return_url` redirect
  // drives the post-checkout state via the `session_id` query param (BTS-62).
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
      </div>
    );
  }

  return (
    <EmbeddedCheckout
      publishableKey={publishableKey}
      clientSecret={clientSecret}
    />
  );
}

/**
 * BTS-58: destination charge + platform fee demo (single recipient). A buyer
 * buys a seeded store's one-time price as a plain destination charge — funds
 * route to the seller, the platform keeps its fee — and the resulting
 * fee/payout breakdown is shown, reconciling exactly to the charge amount.
 *
 * Unlike BTS-42 (recurring, two-page redirect) and BTS-43 (multi-recipient
 * split), this is the simplest case: one seller, one one-time charge, no
 * affiliate routing. The breakdown is computed from the known price up front
 * (`getDestinationChargeDemoContext`) rather than read back from a ledger —
 * a fixed one-time price has no proration, so the eventual charge amount is
 * never in question.
 */
export function DestinationChargeDemo() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const context = useQuery(api.marketplace.getDestinationChargeDemoContext);
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const session = useQuery(
    api.queries.getCheckoutSessionByStripeId,
    sessionId ? { stripeSessionId: sessionId } : "skip",
  );

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

  const { buyer, store, price, feePercent, breakdown } = context;
  const isComplete = session?.status === "complete";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          Buy from {store.storeName} — destination charge
        </h1>
        <p className="text-muted-foreground">
          {buyer.name} buys {store.storeName}'s one-time product as a real
          destination charge — funds route to the seller and the platform
          keeps its fee, in a single charge (no affiliate split).
        </p>
      </div>

      <Card>
        <CardContent className="space-y-1 p-6">
          <div className="flex justify-between">
            <span>Price</span>
            <span className="font-medium">
              {formatCurrency(price.unitAmount, price.currency)}
            </span>
          </div>
          <div className="text-muted-foreground flex justify-between text-sm">
            <span>Platform fee</span>
            <span>{feePercent}% application fee</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run the sale</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionId ? (
            session === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : isComplete ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span>Charge complete — see the breakdown below.</span>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Payment is being processed...
              </p>
            )
          ) : (
            <DestinationChargeCheckoutForm
              userId={buyer.id}
              stripePriceId={price.stripePriceId}
              destinationAccountId={store.stripeAccountId}
              amount={price.unitAmount}
              publishableKey={publishableKey}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee + payout breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isComplete && (
            <Badge data-testid="charge-complete-badge">Charge complete</Badge>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Figure
              label="Charged"
              value={formatCurrency(breakdown.gross, price.currency)}
            />
            <Figure
              label={`Platform fee (${feePercent}%)`}
              value={formatCurrency(breakdown.fee, price.currency)}
            />
            <Figure
              label="Seller payout"
              value={formatCurrency(breakdown.net, price.currency)}
            />
          </div>
          {breakdown.reconciles ? (
            <p className="text-muted-foreground text-sm">
              Fee + seller payout reconciles exactly to the charge amount.
            </p>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Breakdown does not reconcile</AlertTitle>
              <AlertDescription>
                Fee + payout does not equal the charge amount — this should
                never happen.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
