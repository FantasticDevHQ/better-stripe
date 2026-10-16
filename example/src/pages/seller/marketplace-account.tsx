import { DEFAULT_CONNECT_COUNTRIES as CONNECT_COUNTRIES } from "@fantastic.dev/better-stripe/react";
import {
  useOnboarding,
  useAccountManager,
  useWorkflowAction,
} from "@fantastic.dev/better-stripe/react";
import { AccountConfigurations } from "@/components/account-configurations";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  CheckoutStatus,
  ConnectStatusBadge,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { ArrowRight, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import { selectPurchasablePrices } from "../../../convex/marketplace/helpers";

/**
 * BTS-46 — "one V2 account, configurations accrue" lifecycle demo, distinct
 * from `/seller/onboarding` (which onboards as `merchant`). This page:
 *  1. Onboards a seller via hosted Stripe Express as a `recipient` (payouts).
 *  2. Adds the `customer` configuration to the SAME account.
 *  3. Lets that same account purchase a platform price as a customer.
 *  4. Demonstrates adding further configurations (recipient/merchant) later.
 */
export function SellerMarketplaceAccount({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const Heading = embedded ? "h2" : "h1";
  const { currentUser } = useRole();
  const [searchParams] = useSearchParams();
  const purchaseSessionId = searchParams.get("purchase_session_id");

  const account = useQuery(api.accounts.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const products = useQuery(api.products.queries.listProductsWithPrices);
  const purchaseSession = useQuery(
    api.billing.public.queries.getCheckoutSessionByStripeId,
    purchaseSessionId ? { stripeSessionId: purchaseSessionId } : "skip",
  );

  const createOnboarding = useAction(
    api.marketplace.accountActions.createMarketplaceAccountOnboarding,
  );
  const getAccountLink = useAction(
    api.accounts.actions.getAccountLinkWithStatus,
  );
  const addCustomerConfig = useAction(
    api.marketplace.accountActions.addMarketplaceCustomerConfig,
  );
  const addRecipientConfig = useAction(
    api.marketplace.accountActions.addMarketplaceRecipientConfig,
  );
  const addMerchantConfig = useAction(
    api.marketplace.accountActions.addMarketplaceMerchantConfig,
  );
  const createSelfPurchase = useAction(
    api.marketplace.accountActions.createMarketplaceSelfPurchaseCheckout,
  );

  const [selectedPriceId, setSelectedPriceId] = useState<string | undefined>(
    undefined,
  );
  const {
    selectedCountry,
    setSelectedCountry,
    isCreating,
    isLinking,
    createError,
    linkError,
    create: createAccount,
    continue: continueOnboarding,
  } = useOnboarding({
    scopeKey: currentUser.id,
    createAccount: (country) =>
      createOnboarding({
        userId: currentUser.id,
        email: currentUser.email,
        country,
        refreshUrl: window.location.href,
        returnUrl: window.location.origin + "/seller/marketplace-account",
      }),
    continueOnboarding: () =>
      getAccountLink({
        stripeAccountId: account!.stripeAccountId,
        refreshUrl: window.location.href,
        returnUrl: window.location.origin + "/seller/marketplace-account",
      }),
  });
  const accountManager = useAccountManager({
    scopeKey: currentUser.id,
    configure: (configuration) => {
      const args = { stripeAccountId: account!.stripeAccountId };
      return configuration === "customer"
        ? addCustomerConfig(args)
        : configuration === "recipient"
          ? addRecipientConfig(args)
          : addMerchantConfig(args);
    },
  });
  const isAddingCustomer =
    accountManager.isPending &&
    accountManager.pendingConfiguration === "customer";
  const isAddingRecipient =
    accountManager.isPending &&
    accountManager.pendingConfiguration === "recipient";
  const isAddingMerchant =
    accountManager.isPending &&
    accountManager.pendingConfiguration === "merchant";
  const addCustomerError =
    accountManager.lastConfiguration === "customer" && accountManager.error;
  const addRecipientError =
    accountManager.lastConfiguration === "recipient" && accountManager.error;
  const addMerchantError =
    accountManager.lastConfiguration === "merchant" && accountManager.error;
  const purchaseAction = useWorkflowAction(async () => {
    if (!selectedPriceId) throw new Error("Choose a price first.");
    return createSelfPurchase({
      userId: currentUser.id,
      stripeAccountId: account!.stripeAccountId,
      stripePriceId: selectedPriceId,
      returnUrl:
        window.location.origin +
        "/seller/marketplace-account?purchase_session_id={CHECKOUT_SESSION_ID}",
    });
  }, currentUser.id);
  const isPurchasing = purchaseAction.isPending;
  const purchaseError = purchaseAction.error;
  const purchase = async () => {
    const result = await purchaseAction.run();
    if (result?.url) window.location.assign(result.url);
  };

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // No account yet — onboard as a recipient via hosted Express.
  if (account === null) {
    return (
      <div className="space-y-6">
        <div>
          <Heading className="text-2xl font-bold">
            {embedded ? "Stripe settings" : "Marketplace Account"}
          </Heading>
          <p className="text-muted-foreground mt-1">
            One Stripe account can be a payouts recipient AND a paying customer.
            This demo onboards you as a recipient first.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Get Started</CardTitle>
            <CardDescription>
              Select your country and we'll redirect you to Stripe Express to
              verify your identity and connect a bank account for payouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="marketplace-country">Country</Label>
                <Select
                  value={selectedCountry}
                  onValueChange={(v: string | null) =>
                    v && setSelectedCountry(v)
                  }
                >
                  <SelectTrigger id="marketplace-country" className="w-64">
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
                    Onboard as recipient
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
  const isOnboardingComplete = onboardingStatus === "complete";
  const appliedConfigurations = (account.appliedConfigurations ??
    []) as string[];
  const hasCustomerConfig = appliedConfigurations.includes("customer");
  const hasRecipientConfig = appliedConfigurations.includes("recipient");
  const hasMerchantConfig = appliedConfigurations.includes("merchant");

  // Platform-owned (accountId undefined), one-time prices — the "buy
  // something" step never needs a destination charge, so any active price
  // works, but one-time keeps the demo purchase simple.
  const purchasablePrices = selectPurchasablePrices(products ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Heading className="text-2xl font-bold">
            {embedded ? "Stripe settings" : "Marketplace Account"}
          </Heading>
          <p className="text-muted-foreground mt-1">
            One account, configurations accrue: recipient (payouts) → customer
            (billable) → optionally more later.
          </p>
        </div>
        <ConnectStatusBadge status={onboardingStatus} />
      </div>

      {purchaseSessionId && (
        <CheckoutStatus
          status={
            purchaseSession?.status as
              "open" | "complete" | "expired" | undefined
          }
          isLoading={purchaseSession === undefined}
          renderComplete={() => (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Purchase complete</AlertTitle>
              <AlertDescription>
                This account just bought something as a customer — using the
                exact same <code className="font-mono">stripeAccountId</code>{" "}
                that receives payouts as a recipient.
              </AlertDescription>
            </Alert>
          )}
          renderOpen={() => (
            <Alert>
              <AlertTitle>Payment processing…</AlertTitle>
            </Alert>
          )}
          renderExpired={() => (
            <Alert variant="destructive">
              <AlertTitle>Checkout session expired</AlertTitle>
            </Alert>
          )}
        />
      )}

      {/* Step 1: recipient onboarding */}
      {!isOnboardingComplete && (
        <Card>
          <CardHeader>
            <CardTitle>Step 1 — Complete Recipient Onboarding</CardTitle>
            <CardDescription>
              Stripe requires identity verification and banking details before
              this account can receive payouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {missingRequirements.length > 0 && (
                <>
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
                  <Separator />
                </>
              )}
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

              {linkError && (
                <Alert variant="destructive">
                  <AlertTitle>Action failed</AlertTitle>
                  <AlertDescription>{linkError}</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isOnboardingComplete && (
        <>
          {/* Applied configurations */}
          <AccountConfigurations configurations={appliedConfigurations} />

          {/* Step 2: add customer config */}
          {!hasCustomerConfig && (
            <Card>
              <CardHeader>
                <CardTitle>Step 2 — Add Customer Configuration</CardTitle>
                <CardDescription>
                  Make this same account billable so it can purchase as a
                  customer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => void accountManager.configure("customer")}
                  disabled={isAddingCustomer}
                >
                  {isAddingCustomer ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding customer configuration...
                    </>
                  ) : (
                    "Add customer configuration"
                  )}
                </Button>

                {addCustomerError && (
                  <Alert variant="destructive">
                    <AlertTitle>Action failed</AlertTitle>
                    <AlertDescription>{addCustomerError}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 2b: same account buys something as a customer */}
          {hasCustomerConfig && (
            <Card>
              <CardHeader>
                <CardTitle>Step 2 — Buy Something as This Account</CardTitle>
                <CardDescription>
                  This account is now both a payouts recipient AND a billable
                  customer. Pick something to buy to prove it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {purchasablePrices.length === 0 ? (
                    <Alert>
                      <AlertDescription>
                        No data found for one-time platform prices. Seed demo
                        data first.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label>Item</Label>
                        <Select
                          value={selectedPriceId}
                          onValueChange={(v: string | null) =>
                            v && setSelectedPriceId(v)
                          }
                        >
                          <SelectTrigger
                            className="w-72"
                            aria-label="Product and price to buy"
                          >
                            <SelectValue placeholder="Select something to buy" />
                          </SelectTrigger>
                          <SelectContent>
                            {purchasablePrices.map((price) => (
                              <SelectItem
                                key={price.stripePriceId}
                                value={price.stripePriceId}
                              >
                                {price.productName} —{" "}
                                {(price.unitAmount / 100).toLocaleString(
                                  undefined,
                                  {
                                    style: "currency",
                                    currency: price.currency,
                                  },
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={purchase}
                        disabled={isPurchasing || !selectedPriceId}
                      >
                        {isPurchasing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Redirecting to Stripe...
                          </>
                        ) : (
                          <>
                            Buy as this account
                            <ArrowRight
                              data-icon="inline-end"
                              className="ml-2 h-4 w-4"
                            />
                          </>
                        )}
                      </Button>

                      {purchaseError && (
                        <Alert variant="destructive">
                          <AlertTitle>Action failed</AlertTitle>
                          <AlertDescription>{purchaseError}</AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: add more configurations later */}
          {(!hasRecipientConfig || !hasMerchantConfig) && (
            <Card>
              <CardHeader>
                <CardTitle>Step 3 — Add More Configurations Later</CardTitle>
                <CardDescription>
                  Configurations accrue on one account — nothing stops you from
                  adding recipient or merchant capabilities after the fact, if
                  this account didn't start with them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {!hasRecipientConfig && (
                    <Button
                      variant="outline"
                      onClick={() => void accountManager.configure("recipient")}
                      disabled={isAddingRecipient}
                    >
                      {isAddingRecipient ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        "Add recipient configuration"
                      )}
                    </Button>
                  )}
                  {!hasMerchantConfig && (
                    <Button
                      variant="outline"
                      onClick={() => void accountManager.configure("merchant")}
                      disabled={isAddingMerchant}
                    >
                      {isAddingMerchant ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        "Add merchant configuration"
                      )}
                    </Button>
                  )}

                  {(addRecipientError || addMerchantError) && (
                    <Alert variant="destructive" className="w-full">
                      <AlertTitle>Action failed</AlertTitle>
                      <AlertDescription>
                        {addRecipientError ?? addMerchantError}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
