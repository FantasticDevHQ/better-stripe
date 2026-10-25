import { useEffect, useRef, useState } from "react";
import { openRetainedPortal } from "@/lib/portal-request";
import { EmptyState } from "@/components/empty-state";
import { StorePaymentSource } from "@/components/store-payment-source";
import { StoreInvoiceEstimate } from "@/components/store-invoice-estimate";
import { useAction, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import {
  BillingPortal,
  EmbeddedCheckout,
  formatPrice,
  usePlanBilling,
} from "@fantastic.dev/better-stripe/react";
import { useRole } from "@/providers/role-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type StorePlanId } from "../../../convex/storePlans/helpers";

export function SellerPlan() {
  const { currentUser } = useRole();
  const sellerId = currentUser.id as Id<"users">;
  const state = useQuery(
    api.storePlans.billing.public.queries.getState,
    sellerId ? { sellerId } : "skip",
  );
  const plans = useQuery(api.storePlans.pricing.public.queries.list, {});
  const publishableKey = useQuery(api.stripe.public.queries.getPublishableKey);
  const createCheckout = useAction(
    api.storePlans.public.actions.createCheckout,
  );
  const manage = useAction(api.storePlans.public.actions.manage);
  const prepareManage = useAction(api.storePlans.public.actions.prepareManage);
  const portalScope = `${sellerId}:${state?.stripeAccountId}:${state?.storePlan?.stripeSubscriptionId}`;
  const lifetime = useRef<{ key: string; active: boolean } | null>(null);
  useEffect(() => {
    const owner = { key: portalScope, active: true };
    lifetime.current = owner;
    return () => {
      owner.active = false;
    };
  }, [portalScope]);
  const portalLock = useRef(false);
  const [portalPending, setPortalPending] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const namespace = `better-stripe:example:portal:${sellerId}`;
  async function retainedPortal(targetPlanId?: StorePlanId) {
    if (portalLock.current)
      throw new Error("A billing request is already pending.");
    if (!state?.stripeAccountId || !state.storePlan)
      throw new Error("Choose a store plan first.");
    const owner = lifetime.current;
    portalLock.current = true;
    setPortalPending(true);
    try {
      const returnUrl = `${window.location.origin}/seller/plan`;
      const args = {
        sellerId,
        returnUrl,
        ...(targetPlanId ? { targetPlanId } : {}),
      };
      return await openRetainedPortal({
        storage: window.sessionStorage,
        namespace,
        selection: JSON.stringify({
          sellerId,
          account: state.stripeAccountId,
          subscription: state.storePlan.stripeSubscriptionId,
          targetPlanId: targetPlanId ?? null,
          returnUrl,
        }),
        prepare: (key) => prepareManage({ ...args, key }),
        create: (requestIdentity) => manage({ ...args, requestIdentity }),
        isCurrent: () =>
          owner !== null &&
          owner.active &&
          lifetime.current === owner &&
          owner.key === portalScope,
      });
    } finally {
      portalLock.current = false;
      setPortalPending(false);
    }
  }
  function newPortalRequest() {
    if (portalLock.current) return;
    try {
      window.sessionStorage.removeItem(namespace);
      setRequestError(undefined);
    } catch {
      setRequestError("Billing request storage is unavailable.");
    }
  }
  const confirm = useAction(api.storePlans.public.actions.confirmCheckout);
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const {
    clientSecret,
    isPending: busy,
    error,
    choose,
    openPortal,
  } = usePlanBilling({
    scopeKey: portalScope,
    sessionId,
    confirm: (sessionId) => confirm({ sellerId, sessionId }),
    createCheckout: (planId: StorePlanId) =>
      createCheckout({
        sellerId,
        planId,
        returnUrl: `${window.location.origin}/seller/plan?session_id={CHECKOUT_SESSION_ID}`,
      }),
    createPortal: () => retainedPortal(),
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
                  <Button
                    disabled={busy || portalPending}
                    onClick={() => void openPortal()}
                  >
                    Manage plan, billing & cancellation
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {state?.storePlan && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Retries retain the same billing request in this tab. If the outcome
            is unknown, check billing before deliberately starting another
            request.
          </p>
          <Button
            variant="outline"
            disabled={portalPending || busy}
            onClick={newPortalRequest}
          >
            Start a new billing request
          </Button>
          {requestError && <p role="alert">{requestError}</p>}
        </div>
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
                    {formatPrice(plan.monthlyAmount, "usd")}
                    <span className="text-sm font-normal"> / month</span>
                  </p>
                  <p>{plan.feeLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    Default affiliate payout:{" "}
                    {plan.effectiveFixedAmount != null
                      ? `${plan.effectiveFixedAmount} in the sale currency, capped at proceeds`
                      : `${plan.effectiveBasisPoints / 100}% after the sale fee`}
                    .
                  </p>
                  {state?.hasAccess &&
                    state.storePlan &&
                    state.storePlan.planId !== plan.id && (
                      <BillingPortal
                        scopeKey={`${portalScope}:${plan.id}`}
                        createSession={() => retainedPortal(plan.id)}
                      >
                        {({ open, isPending, error: portalError }) => (
                          <div>
                            <Button
                              disabled={isPending || portalPending || busy}
                              onClick={() => void open()}
                            >
                              {isPending
                                ? "Opening confirmation…"
                                : `Review change to ${plan.name}`}
                            </Button>
                            {portalError && <p role="alert">{portalError}</p>}
                          </div>
                        )}
                      </BillingPortal>
                    )}
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
