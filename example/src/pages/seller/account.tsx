import { IntegrationExamples } from "@/components/integration-examples";
import { ConnectExample } from "@/components/connect-example";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SellerOnboarding } from "./onboarding";
import { SellerMarketplaceAccount } from "./marketplace-account";
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
  useAccountManager,
  AccountLoginCard,
  ConnectRequirements,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";

import { api } from "../../../convex/_generated/api";

function AccountDetails() {
  const { currentUser } = useRole();
  const createLoginLink = useAction(api.actions.createSellerLoginLink);
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });

  const {
    isPending: pending,
    error,
    openDashboard,
  } = useAccountManager({
    scopeKey: currentUser.id,
    createDashboardLink: () =>
      createLoginLink({
        userId: currentUser.id,
        stripeAccountId: account!.stripeAccountId,
      }),
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
        <h2 className="text-xl font-semibold">Account details</h2>
        <Alert>
          <AlertDescription>
            No data found for a Stripe Connect account. Visit the{" "}
            <a
              href="/seller/account?section=setup"
              className="text-primary underline"
            >
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
      <h2 className="text-xl font-semibold">Account details</h2>
      <p className="text-muted-foreground">
        Manage your Stripe Connect account details and access your Express
        dashboard.
      </p>

      {/* Stripe Express dashboard link */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AccountLoginCard
        onLogin={openDashboard}
        renderDashboardLink={({ onLogin }) => (
          <Button onClick={onLogin} disabled={pending}>
            {pending ? "Opening dashboard…" : "Open dashboard"}
          </Button>
        )}
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

export function SellerAccount() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("section");
  const section =
    selected === "setup" || selected === "stripe-settings"
      ? selected
      : "details";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your store's Stripe account, setup, and payment capabilities.
        </p>
      </div>
      <Tabs
        value={section}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("section", String(value));
          setParams(next);
        }}
      >
        <TabsList className="max-w-full">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="stripe-settings">Stripe settings</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <div className="pt-4">
            <IntegrationExamples
              headless={<AccountDetails />}
              embedded={<ConnectExample kind="account" />}
            />
          </div>
        </TabsContent>
        <TabsContent value="setup">
          <div className="pt-4">
            <IntegrationExamples
              headless={<SellerOnboarding embedded />}
              embedded={<ConnectExample kind="onboarding" />}
            />
          </div>
        </TabsContent>
        <TabsContent value="stripe-settings">
          <div className="pt-4">
            <IntegrationExamples
              headless={<SellerMarketplaceAccount embedded />}
              embedded={<ConnectExample kind="notifications" />}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
