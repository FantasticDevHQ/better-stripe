import { useAction, useQuery } from "convex/react";
import {
  Connect,
  type ConnectComponent,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { useTheme } from "@/providers/use-theme";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
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
export function ConnectExample({ kind }: { kind: ConnectComponent }) {
  const { currentUser } = useRole();
  const { resolvedTheme } = useTheme();
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const create = useAction(api.embeddedExamples.createSession);
  if (!currentUser.stripeAccountId)
    return (
      <Alert>
        <AlertTitle>Stripe account required</AlertTitle>
        <AlertDescription>
          Set up this persona's Stripe account before opening the embedded
          example.
        </AlertDescription>
      </Alert>
    );
  const dark = resolvedTheme === "dark";
  return (
    <div className="space-y-4" data-testid={`connect-example-${kind}`}>
      <h1 className="text-2xl font-bold">{titles[kind]}</h1>
      {["payments", "refunds", "disputes"].includes(kind) && (
        <Alert>
          <AlertTitle>Connected-account charges</AlertTitle>
          <AlertDescription>
            Stripe shows this account's own charges and supported destination
            charges here. The example's marketplace sales use platform charges
            with separate seller and affiliate transfers. Manage those sales,
            refunds, and disputes in the via API view.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Stripe embedded {titles[kind].toLowerCase()}</CardTitle>
        </CardHeader>
        <CardContent>
          {publishableKey === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : !publishableKey ? (
            <EmptyState>
              No publishable key is configured. Configure Stripe in Admin setup.
            </EmptyState>
          ) : (
            <Connect
              component={kind}
              scopeKey={`${currentUser.id}:${resolvedTheme}`}
              publishableKey={publishableKey}
              appearance={{
                variables: {
                  colorBackground: dark ? "#171717" : "#ffffff",
                  colorText: dark ? "#fafafa" : "#171717",
                  colorPrimary: dark ? "#fafafa" : "#171717",
                },
              }}
              fetchClientSecret={async () =>
                (await create({ userId: currentUser.id as Id<"users">, kind }))
                  .clientSecret
              }
            >
              {({ content, error, retry, completed }) => (
                <>
                  {completed && (
                    <p role="status">
                      Account setup completed. Review the latest requirements in
                      the via API view.
                    </p>
                  )}
                  {error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Component unavailable</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                      <div className="mt-3">
                        <Button variant="outline" onClick={retry}>
                          Retry
                        </Button>
                      </div>
                    </Alert>
                  ) : (
                    content
                  )}
                </>
              )}
            </Connect>
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
