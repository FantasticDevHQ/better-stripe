import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckoutStatus } from "@getdojo/better-stripe/react";
import { useQuery } from "convex/react";
import { CheckCircle, XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../../convex/_generated/api";

export function CheckoutStatusPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const session = useQuery(
    api.queries.getCheckoutSessionByStripeId,
    sessionId ? { stripeSessionId: sessionId } : "skip",
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

  const status = session?.status as "open" | "complete" | "expired" | undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <CheckoutStatus
        status={status}
        isLoading={session === undefined}
        renderComplete={() => (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <h1 className="text-2xl font-bold">Payment successful!</h1>
              <p className="text-muted-foreground">
                {session?.mode === "payment"
                  ? "Your purchase is complete — thanks for your order!"
                  : "Your subscription is now active. You can start learning right away."}
              </p>
              <Button
                render={<Link to="/dashboard" aria-label="Go to dashboard" />}
              >
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        )}
        renderExpired={() => (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <h1 className="text-2xl font-bold">Session expired</h1>
              <p className="text-muted-foreground">
                This checkout session has expired. Please try again.
              </p>
              <Button render={<Link to="/" aria-label="Back to pricing" />}>
                Back to pricing
              </Button>
            </CardContent>
          </Card>
        )}
        renderOpen={() => (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <p className="text-muted-foreground">
                Your payment is being processed...
              </p>
            </CardContent>
          </Card>
        )}
      />

      {session === null && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-500" />
            <h1 className="text-2xl font-bold">Session not found</h1>
            <p className="text-muted-foreground">
              No data found for this checkout session.
            </p>
            <Button render={<Link to="/" aria-label="Back to pricing" />}>
              Back to pricing
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
