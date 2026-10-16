import { CheckoutTypeExamples } from "@/components/checkout-types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../../convex/_generated/api";

export function Checkout() {
  const [searchParams] = useSearchParams();
  const priceId = searchParams.get("priceId");
  const referralCode = searchParams.get("ref") ?? undefined;
  const publishableKey = useQuery(api.stripe.public.queries.getPublishableKey);

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
          nativeButton={false}
          role="link"
          render={<Link to="/" aria-label="Back to pricing" />}
        >
          Back to pricing
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="text-muted-foreground">
          Complete your purchase securely with Stripe.
        </p>
      </div>

      <Card>
        <CardContent padding="lg">
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
            <CheckoutTypeExamples
              priceId={priceId}
              referralCode={referralCode}
              publishableKey={publishableKey}
            />
          )}
        </CardContent>
      </Card>

      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        role="link"
        render={<Link to="/" aria-label="Back to pricing" />}
      >
        <ArrowLeft data-icon="inline-start" className="mr-1 h-3 w-3" />
        Back to pricing
      </Button>
    </div>
  );
}
