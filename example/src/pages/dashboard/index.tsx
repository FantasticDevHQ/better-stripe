import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString();
}

export function Dashboard() {
  const { currentUser } = useRole();
  // Scope to the signed-in persona — never surface another account's
  // subscription (the account-less visitor sees their own empty state).
  const subscriptions = useQuery(api.queries.listSubscriptionsByUser, {
    userId: currentUser.id,
  });

  if (subscriptions === undefined) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <Card>
          <div className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  const userSubscription = subscriptions.find(
    (s) => s.status === "active" || s.status === "trialing",
  );

  const hasSubscription = !!userSubscription;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {currentUser.name}</h1>
        <p className="text-muted-foreground mt-1">
          Here's an overview of your account.
        </p>
      </div>

      {/* Subscription Status */}
      {hasSubscription ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {userSubscription.stripeSubscriptionId}
                </p>
                <p className="text-muted-foreground text-sm">
                  Renews {formatDate(userSubscription.currentPeriodEnd)}
                </p>
              </div>
              <Badge variant="default" className="capitalize">
                {userSubscription.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Alert>
              <AlertTitle>No Active Subscription</AlertTitle>
              <AlertDescription>
                Browse our t-shirt collection and subscribe for exclusive
                access.
              </AlertDescription>
            </Alert>
            <Button
              render={<Link to="/" aria-label="Browse plans" />}
              className="mt-4"
            >
              View Plans
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
