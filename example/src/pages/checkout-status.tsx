import { CapturedCheckoutReceipt } from "@/components/captured-checkout-receipt";
import { PaymentIntentReceipt } from "@/components/payment-intent-receipt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckoutStatus } from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";
import { CheckCircle, XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../../convex/_generated/api";

import { useRole } from "@/providers/role-context";

export function CheckoutStatusPage() {
  const { currentRole } = useRole();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const session = useQuery(
    api.billing.public.queries.getCheckoutSessionByStripeId,
    sessionId ? { stripeSessionId: sessionId } : "skip",
  );

  if (searchParams.get("payment_intent"))
    return (
      <PaymentIntentReceipt
        paymentIntentId={searchParams.get("payment_intent")!}
      />
    );

  if (!sessionId) {
    return (
      <div className="space-y-4 py-16 text-center">
        <Alert>
          <AlertTitle>No session found</AlertTitle>
          <AlertDescription>Missing checkout session ID.</AlertDescription>
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

  if (session === undefined) {
    return (
      <div className="mx-auto max-w-2xl space-y-8 py-8">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // A cached Session status is not captured-payment evidence. Subscription
  // status keeps its existing view; payment receipts require current authority.
  if (session && session.mode !== "subscription") {
    return (
      <div className="mx-auto max-w-2xl space-y-8 py-8">
        <CapturedCheckoutReceipt stripeSessionId={sessionId} />
      </div>
    );
  }

  const status = session?.status as "open" | "complete" | "expired" | undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <CheckoutStatus
        status={status}
        isLoading={session === undefined}
        renderComplete={() => (
          <Card>
            <CardContent padding="status">
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-success" />
                <h1 className="text-2xl font-bold">Payment successful!</h1>
                <p className="text-muted-foreground">
                  Your subscription is now active. You can start learning right
                  away.
                </p>
                {typeof session?.metadata?.productName === "string" && (
                  <p className="font-medium">{session.metadata.productName}</p>
                )}
                <Button
                  nativeButton={false}
                  role="link"
                  render={
                    <Link
                      to={currentRole === "customer" ? "/dashboard" : "/stores"}
                      aria-label={
                        currentRole === "customer"
                          ? "Go to Dashboard"
                          : "Continue shopping"
                      }
                    />
                  }
                >
                  {currentRole === "customer"
                    ? "Go to Dashboard"
                    : "Continue shopping"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        renderExpired={() => (
          <Card>
            <CardContent padding="status">
              <div className="space-y-4 text-center">
                <XCircle className="mx-auto h-12 w-12 text-destructive" />
                <h1 className="text-2xl font-bold">Session expired</h1>
                <p className="text-muted-foreground">
                  This checkout session has expired. Please try again.
                </p>
                <Button
                  nativeButton={false}
                  role="link"
                  render={<Link to="/" aria-label="Back to pricing" />}
                >
                  Back to pricing
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        renderOpen={() => (
          <Card>
            <CardContent padding="status">
              <div className="space-y-4 text-center">
                <p className="text-muted-foreground">
                  Your payment is being processed...
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      />

      {session === null && (
        <Card>
          <CardContent padding="status">
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto h-12 w-12 text-destructive" />
              <h1 className="text-2xl font-bold">Session not found</h1>
              <p className="text-muted-foreground">
                No data found for this checkout session.
              </p>
              <Button
                nativeButton={false}
                role="link"
                render={<Link to="/" aria-label="Back to pricing" />}
              >
                Back to pricing
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
