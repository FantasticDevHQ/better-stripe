import { DEFAULT_CONNECT_COUNTRIES as CONNECT_COUNTRIES } from "@fantastic.dev/better-stripe/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  useOnboarding,
  AccountCloseCard,
  ConnectStatusBadge,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  HelpCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";

export function SellerOnboarding({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const Heading = embedded ? "h2" : "h1";
  const { currentUser } = useRole();
  const account = useQuery(api.accounts.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const createAccountWithOnboarding = useAction(
    api.accounts.actions.createAccountWithOnboarding,
  );
  const getAccountLink = useAction(
    api.accounts.actions.getAccountLinkWithStatus,
  );
  const restartOnboarding = useAction(
    api.accounts.actions.restartAccountOnboarding,
  );
  const {
    selectedCountry,
    setSelectedCountry,
    isCreating,
    isLinking,
    isRestarting,
    createError,
    linkError,
    restartError,
    create: createAccount,
    continue: continueOnboarding,
    close: closeAccount,
  } = useOnboarding({
    scopeKey: currentUser.id,
    createAccount: (country) =>
      createAccountWithOnboarding({
        userId: currentUser.id,
        email: currentUser.email,
        country,
        refreshUrl: window.location.href,
        returnUrl: window.location.origin + "/seller/onboarding",
      }),
    continueOnboarding: () =>
      getAccountLink({
        stripeAccountId: account!.stripeAccountId,
        refreshUrl: window.location.href,
        returnUrl: window.location.origin + "/seller/onboarding",
      }),
    closeAccount: () =>
      restartOnboarding({ stripeAccountId: account!.stripeAccountId }),
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

  // No account yet — show account creation
  if (account === null) {
    return (
      <div className="space-y-6">
        <div>
          <Heading className="text-2xl font-bold">
            {embedded ? "Setup" : "Seller Onboarding"}
          </Heading>
          <p className="text-muted-foreground mt-1">
            No data yet. Create a Stripe Connect account to start receiving
            payouts.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Get Started</CardTitle>
            <CardDescription>
              Select your country and we'll redirect you to Stripe to verify
              your identity and connect your bank account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="onboarding-country">Country</Label>
                <Select
                  value={selectedCountry}
                  onValueChange={(v: string | null) =>
                    v && setSelectedCountry(v)
                  }
                >
                  <SelectTrigger id="onboarding-country" className="w-64">
                    <SelectValue placeholder="Select a country" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONNECT_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => void createAccount()}
                disabled={isCreating || !selectedCountry}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight
                      data-icon="inline-end"
                      className="ml-2 h-4 w-4"
                    />
                  </>
                )}
              </Button>

              {createError && (
                <Alert variant="destructive">
                  <AlertTitle>Action failed</AlertTitle>
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onboardingStatus = account.onboardingStatus ?? "pending";
  const missingRequirements = (account.missingRequirements ?? []) as string[];
  const isComplete = onboardingStatus === "complete";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Heading className="text-2xl font-bold">
            {embedded ? "Setup" : "Seller Onboarding"}
          </Heading>
          <p className="text-muted-foreground mt-1">
            {isComplete
              ? "Your account is verified and ready to receive payouts."
              : "Complete the steps below to activate payouts on your account."}
          </p>
        </div>
        <ConnectStatusBadge status={onboardingStatus} />
      </div>

      {/* Main onboarding card */}
      <Card>
        <CardHeader>
          <CardTitle>Account Setup</CardTitle>
          <CardDescription>
            {isComplete
              ? "All requirements have been met."
              : "Stripe requires identity verification and banking details before funds can be transferred."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Requirements checklist */}
            {missingRequirements.length > 0 && (
              <>
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm font-medium">
                    {missingRequirements.length} items remaining
                  </p>
                  <div className="grid gap-1.5">
                    {missingRequirements.map((req) => (
                      <div
                        key={req}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Circle className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                        <span className="text-muted-foreground">{req}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {isComplete ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>All requirements met — payouts are active.</span>
              </div>
            ) : (
              <Button
                onClick={() => void continueOnboarding()}
                disabled={isLinking}
              >
                {isLinking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting to Stripe...
                  </>
                ) : (
                  <>
                    Continue setup on Stripe
                    <ArrowRight
                      data-icon="inline-end"
                      className="ml-2 h-4 w-4"
                    />
                  </>
                )}
              </Button>
            )}

            {linkError && (
              <Alert variant="destructive">
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{linkError}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Account info */}
      <Card>
        <CardContent padding="section">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Account ID</span>
              <p className="font-mono">{account.stripeAccountId}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Country</span>
              <p>{account.country ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Email</span>
              <p>{account.email ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="flex items-center gap-1.5">
                <Badge variant={isComplete ? "default" : "secondary"}>
                  {onboardingStatus}
                </Badge>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Restart / Close account */}
      <AccountCloseCard
        status={onboardingStatus}
        onClose={() => void closeAccount()}
        isLoading={isRestarting}
      >
        {({ onClose, isLoading: closing, isComplete: complete }) => (
          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  {complete ? "Close Account" : "Restart Onboarding"}
                </div>
              </CardTitle>
              <CardDescription>
                {complete
                  ? "Close this Stripe account. This action is irreversible."
                  : "Close this account and start fresh. This action is irreversible."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive-solid"
                size="sm"
                onClick={onClose}
                disabled={closing}
              >
                {closing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Closing account...
                  </>
                ) : complete ? (
                  "Close account"
                ) : (
                  "Restart onboarding"
                )}
              </Button>

              {restartError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Action failed</AlertTitle>
                  <AlertDescription>{restartError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </AccountCloseCard>

      {/* Help */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              Need Help?
            </div>
          </CardTitle>
          <CardDescription>
            Ensure your documents are clear and match the name on your account.
            Verification usually completes within a few minutes but may take up
            to 48 hours.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
