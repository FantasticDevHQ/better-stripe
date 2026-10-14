import { EmptyState } from "@/components/empty-state";
import { StorePaymentSource } from "@/components/store-payment-source";
import { StoreInvoiceEstimate } from "@/components/store-invoice-estimate";
import { useAction, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import {
  EmbeddedCheckout,
  usePlanBilling,
} from "@fantastic.dev/better-stripe/react";
import { useRole } from "@/providers/role-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type StorePlanId } from "../../../convex/lib/storePlans";

export function SellerPlan() {
  const { currentUser } = useRole();
  const sellerId = currentUser.id as Id<"users">;
  const state = useQuery(
    api.storePlanBilling.getState,
    sellerId ? { sellerId } : "skip",
  );
  const plans = useQuery(api.storePlanPricing.list, {});
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const createCheckout = useAction(api.storePlanActions.createCheckout);
  const manage = useAction(api.storePlanActions.manage);
  const confirm = useAction(api.storePlanActions.confirmCheckout);
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const {
    clientSecret,
    isPending: busy,
    error,
    choose,
    openPortal,
  } = usePlanBilling({
    scopeKey: sellerId,
    sessionId,
    confirm: (sessionId) => confirm({ sellerId, sessionId }),
    createCheckout: (planId: StorePlanId) =>
      createCheckout({
        sellerId,
        planId,
        returnUrl: `${window.location.origin}/seller/plan?session_id={CHECKOUT_SESSION_ID}`,
      }),
    createPortal: () =>
      manage({ sellerId, returnUrl: `${window.location.origin}/seller/plan` }),
  });
  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-3xl font-bold">Billing</h1>
      <p className="text-muted-foreground">
        Pay monthly to keep your store open. All prices are in USD.
      </p>
      {state && (
        <Card>
          <CardContent padding="section">
            <div className="space-y-3">
              <p>
                {state.hasAccess
                  ? `Your ${state.storePlan?.planId} plan is active.`
                  : "Your store is closed to new purchases until a plan is paid."}
              </p>
              {state.storePlan && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Status: {state.storePlan.status}.{" "}
                    {state.storePlan.cancelAtPeriodEnd
                      ? "Cancels"
                      : "Paid through"}{" "}
                    {new Date(state.storePlan.paidThrough).toLocaleDateString()}
                    .
                  </p>
                  <Button disabled={busy} onClick={() => void openPortal()}>
                    Manage plan, billing & cancellation
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {state && !state.storePlan && (
        <EmptyState>
          No store plan yet. Choose a monthly plan below to open your store.
        </EmptyState>
      )}
      {state?.storePlan && (
        <StorePaymentSource key={`source:${sellerId}`} sellerId={sellerId} />
      )}
      {state?.storePlan && (
        <StoreInvoiceEstimate key={sellerId} sellerId={sellerId} />
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!clientSecret && (
        <div className="grid gap-4 md:grid-cols-3">
          {plans?.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-3xl font-bold">
                    ${plan.monthlyAmount / 100}
                    <span className="text-sm font-normal"> / month</span>
                  </p>
                  <p>{plan.feeLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    Default affiliate payout:{" "}
                    {plan.affiliateFixedAmount != null
                      ? `${plan.affiliateFixedAmount} in the sale currency, capped at proceeds`
                      : `${(plan.affiliateBasisPoints ?? 2000) / 100}% after the sale fee`}
                    .
                  </p>
                  <Button
                    disabled={
                      busy ||
                      !state ||
                      state.hasAccess ||
                      (!!state.storePlan &&
                        state.storePlan.status !== "canceled" &&
                        state.storePlan.status !== "incomplete_expired") ||
                      !state.stripeAccountId
                    }
                    onClick={() => void choose(plan.id)}
                  >
                    Choose {plan.name}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {clientSecret && publishableKey && (
        <EmbeddedCheckout
          clientSecret={clientSecret}
          publishableKey={publishableKey}
        />
      )}
      <p className="text-sm text-muted-foreground">
        The seller pays the greater of the configured sale fee or actual Stripe
        processing. The platform keeps the difference and never absorbs Stripe
        fees. The store plan sets the default affiliate payout after sale fees;
        product and subscription price overrides take priority. Updated monthly
        prices apply to new subscriptions; existing subscriptions keep their
        current price.
      </p>
    </div>
  );
}
