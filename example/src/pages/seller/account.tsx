import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  AccountLoginCard,
  ConnectRequirements,
} from "@getdojo/better-stripe/react";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

export function SellerAccount() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (account === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Account Settings</h1>
        <Alert>
          <AlertDescription>
            No Stripe Connect account found. Visit the{" "}
            <a href="/seller/onboarding" className="text-primary underline">
              onboarding page
            </a>{" "}
            to create one.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasRequirements =
    account.missingRequirements && account.missingRequirements.length > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Account Settings</h1>
      <p className="text-muted-foreground">
        Manage your Stripe Connect account details and access your Express
        dashboard.
      </p>

      {/* Stripe Express dashboard link */}
      <AccountLoginCard
        onLogin={() => {
          window.open(
            `https://dashboard.stripe.com/${account.stripeAccountId}`,
            "_blank",
          );
        }}
      />

      {/* Account details */}
      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Account ID</dt>
              <dd className="mt-0.5 font-mono">{account.stripeAccountId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="mt-0.5">{account.email ?? "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Country</dt>
              <dd className="mt-0.5">{account.country ?? "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Onboarding Status</dt>
              <dd className="mt-0.5">
                <Badge
                  variant={
                    account.onboardingStatus === "complete"
                      ? "default"
                      : "secondary"
                  }
                >
                  {account.onboardingStatus ?? "unknown"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">
                {new Date(account._creationTime).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Outstanding requirements (if any) */}
      {hasRequirements && (
        <Card>
          <CardHeader>
            <CardTitle>Action Required</CardTitle>
            <CardDescription>
              Stripe requires additional information to keep your account
              active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectRequirements
              requirements={account.missingRequirements ?? []}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
