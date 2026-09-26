import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import { EmbeddedCheckout } from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../../convex/_generated/api";
import { buildCheckoutReturnUrl } from "../lib/checkout-return-url";

function CheckoutForm({
  priceId,
  userId,
  publishableKey,
}: {
  priceId: string;
  userId: string;
  publishableKey: string;
}) {
  const createCheckout = useAction(api.actions.createCheckoutSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasInitiated = useRef(false);

  const initCheckout = useCallback(async () => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;
    try {
      const session = await createCheckout({
        userId,
        stripePriceId: priceId,
        returnUrl: buildCheckoutReturnUrl(window.location.origin),
      });
      if (session?.clientSecret) {
        setClientSecret(session.clientSecret);
      } else {
        setError(
          "Failed to create checkout session. No client secret returned.",
        );
      }
    } catch (err) {
      console.error("Checkout session error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create checkout session.",
      );
    }
  }, [createCheckout, userId, priceId]);

  // Kick off checkout-session creation once on mount. The `hasInitiated`
  // ref guard inside `initCheckout` keeps it idempotent under StrictMode's
  // double-invoked effects.
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

  // No onComplete handler: Stripe substitutes the real session id into
  // return_url and redirects there itself (see buildCheckoutReturnUrl).
  return (
    <EmbeddedCheckout
      publishableKey={publishableKey}
      clientSecret={clientSecret}
    />
  );
}

export function Checkout() {
  const [searchParams] = useSearchParams();
  const priceId = searchParams.get("priceId");
  const { currentUser } = useRole();
  const publishableKey = useQuery(api.queries.getPublishableKey);

  if (!priceId) {
    return (
      <div className="space-y-4 py-16 text-center">
        <Alert>
          <AlertTitle>No price selected</AlertTitle>
          <AlertDescription>
            Please select a price from the pricing page to continue.
          </AlertDescription>
        </Alert>
        <Button
          variant="link"
          render={<Link to="/" aria-label="Back to pricing" />}
        >
          Back to pricing
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="text-muted-foreground">
          Completing purchase for price:{" "}
          <code className="bg-muted rounded px-2 py-0.5 text-sm">
            {priceId}
          </code>
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          {publishableKey === undefined ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : publishableKey === null || publishableKey.length === 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Checkout is unavailable</AlertTitle>
              <AlertDescription>
                No data found for the Stripe publishable key. Configure it in
                the admin setup page.
              </AlertDescription>
            </Alert>
          ) : (
            <CheckoutForm
              priceId={priceId}
              userId={currentUser.id}
              publishableKey={publishableKey}
            />
          )}
        </CardContent>
      </Card>

      <Button
        variant="ghost"
        size="sm"
        render={<Link to="/" aria-label="Back to pricing" />}
      >
        <ArrowLeft data-icon="inline-start" className="mr-1 h-3 w-3" />
        Back to pricing
      </Button>
    </div>
  );
}
