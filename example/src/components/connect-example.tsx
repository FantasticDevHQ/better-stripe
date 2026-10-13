import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ConnectProvider } from "@fantastic.dev/better-stripe/react";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectBalances,
  ConnectDisputesList,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
  type CommonComponentProps,
} from "@stripe/react-connect-js";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { useTheme } from "@/providers/use-theme";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
type Kind =
  | "account"
  | "onboarding"
  | "payments"
  | "refunds"
  | "disputes"
  | "balances"
  | "payouts"
  | "notifications";
const widgets = {
  account: ConnectAccountManagement,
  onboarding: ConnectAccountOnboarding,
  payments: ConnectPayments,
  refunds: ConnectPayments,
  disputes: ConnectDisputesList,
  balances: ConnectBalances,
  payouts: ConnectPayouts,
  notifications: ConnectNotificationBanner,
};
const titles = {
  account: "Account",
  onboarding: "Account setup",
  payments: "Sales",
  refunds: "Refunds",
  disputes: "Disputes",
  balances: "Balance",
  payouts: "Payouts",
  notifications: "Account requirements",
};
export function ConnectExample({ kind }: { kind: Kind }) {
  const { currentUser } = useRole();
  const { resolvedTheme } = useTheme();
  return (
    <ConnectExampleBody
      key={`${currentUser.id}:${kind}:${resolvedTheme}`}
      userId={currentUser.id as Id<"users">}
      hasAccount={!!currentUser.stripeAccountId}
      kind={kind}
      dark={resolvedTheme === "dark"}
    />
  );
}
function ConnectExampleBody({
  userId,
  hasAccount,
  kind,
  dark,
}: {
  userId: Id<"users">;
  hasAccount: boolean;
  kind: Kind;
  dark: boolean;
}) {
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const create = useAction(api.embeddedExamples.createSession);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [attempt, retry] = useState(0);
  const Widget = widgets[kind];
  const onLoadError: CommonComponentProps["onLoadError"] = ({ error }) =>
    setError(error.message ?? "Stripe could not load this component.");
  if (!hasAccount)
    return (
      <Alert>
        <AlertTitle>Stripe account required</AlertTitle>
        <AlertDescription>
          Set up this persona's Stripe account before opening the embedded
          example.
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="space-y-4" data-testid={`connect-example-${kind}`}>
      <h1 className="text-2xl font-bold">{titles[kind]}</h1>
      {completed && (
        <p role="status">
          Account setup completed. Review the latest requirements in the
          Headless view.
        </p>
      )}
      {["payments", "refunds", "disputes"].includes(kind) && (
        <Alert>
          <AlertTitle>Connected-account charges</AlertTitle>
          <AlertDescription>
            Stripe shows this account's own charges and supported destination
            charges here. The example's marketplace sales use platform charges
            with separate seller and affiliate transfers. Manage those sales,
            refunds, and disputes in the Headless view.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Stripe embedded {titles[kind].toLowerCase()}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Component unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setError(null);
                  retry((n) => n + 1);
                }}
              >
                Retry
              </Button>
            </Alert>
          ) : publishableKey === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : !publishableKey ? (
            <EmptyState>
              No publishable key is configured. Configure Stripe in Admin setup.
            </EmptyState>
          ) : (
            <ConnectProvider
              key={attempt}
              publishableKey={publishableKey}
              appearance={{
                variables: {
                  colorBackground: dark ? "#171717" : "#ffffff",
                  colorText: dark ? "#fafafa" : "#171717",
                  colorPrimary: dark ? "#fafafa" : "#171717",
                },
              }}
              fetchClientSecret={async () => {
                try {
                  return (await create({ userId, kind })).clientSecret;
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not create a Stripe session.",
                  );
                  throw error;
                }
              }}
            >
              <Widget
                onLoadError={onLoadError}
                onExit={() => setCompleted(true)}
              />
            </ConnectProvider>
          )}
        </CardContent>
      </Card>
      <a
        className="text-sm underline"
        href="https://docs.stripe.com/connect/supported-embedded-components?platform=web"
        target="_blank"
        rel="noreferrer"
      >
        Stripe embedded component documentation
      </a>
    </div>
  );
}
