import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAction, useQuery } from "convex/react";
import { Clock, ExternalLink } from "lucide-react";

import { api } from "../../../convex/_generated/api";

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString();
}

export function Billing() {
  const [isCancelling, setIsCancelling] = useState(false);
  const subscriptions = useQuery(api.queries.listSubscriptions);
  const invoices = useQuery(api.queries.listInvoices);
  const cancelSubscription = useAction(api.actions.cancelSubscription);

  if (subscriptions === undefined) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Find the first active/trialing subscription
  const subscription = subscriptions.find(
    (s) => s.status === "active" || s.status === "trialing",
  );

  const isTrialing = subscription?.isTrialing ?? false;
  const trialEnd = subscription?.trialEnd;

  const handleCancel = async () => {
    if (!subscription) return;
    setIsCancelling(true);
    try {
      await cancelSubscription({
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      });
    } catch (err) {
      console.error("Failed to cancel subscription:", err);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription and billing details.
        </p>
      </div>

      {/* Trial Alert */}
      {isTrialing && trialEnd && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>Trial ends {formatDate(trialEnd)}</AlertTitle>
          <AlertDescription>
            Your trial expires on {formatDate(trialEnd)}. Add a payment method
            to continue after your trial.
          </AlertDescription>
        </Alert>
      )}

      {/* Subscription Card */}
      {subscription ? (
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">
                  {subscription.stripeSubscriptionId}
                </p>
                <p className="text-muted-foreground text-sm">
                  {subscription.priceId ?? "Unknown price"}
                </p>
              </div>
              <Badge
                variant={
                  subscription.cancelAtPeriodEnd ? "destructive" : "default"
                }
              >
                {subscription.cancelAtPeriodEnd
                  ? "Cancels at period end"
                  : subscription.status}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              Current period: {formatDate(subscription.currentPeriodStart)}{" "}
              &mdash; {formatDate(subscription.currentPeriodEnd)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active subscription.</p>
          </CardContent>
        </Card>
      )}

      {/* Recent Invoices */}
      {invoices !== undefined && invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoices.slice(0, 5).map((invoice) => (
                <div
                  key={invoice._id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">
                    {invoice.stripeInvoiceId}
                  </span>
                  <span className="font-medium">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: invoice.currency?.toUpperCase() || "USD",
                    }).format((invoice.amountPaid ?? 0) / 100)}
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {invoice.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle>Manage Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  window.open(
                    "https://billing.stripe.com/p/login/test",
                    "_blank",
                  );
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Billing Portal
              </Button>

              {!subscription.cancelAtPeriodEnd && (
                <Button
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={isCancelling}
                >
                  {isCancelling ? "Cancelling..." : "Cancel Subscription"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
