"use client";
import type { ReactNode } from "react";
import { EmbeddedCheckout } from "../components/EmbeddedCheckout.js";
import { formatPrice } from "../lib/price-helpers.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
import type { CheckoutSessionResult } from "./Checkout.js";
export type PlanBillingOptions<PlanId extends string = string> = {
  scopeKey: string;
  sessionId?: string | null;
  confirm?: (sessionId: string) => Promise<unknown>;
  createCheckout: (planId: PlanId) => Promise<CheckoutSessionResult>;
  createPortal: () => Promise<string | { url: string }>;
  onNavigate?: (url: string) => void;
};
export function usePlanBilling<PlanId extends string = string>(
  props: PlanBillingOptions<PlanId>,
) {
  const confirmation = useWorkflowResource(
    () =>
      props.sessionId && props.confirm
        ? props.confirm(props.sessionId)
        : Promise.resolve(null),
    `${props.scopeKey}:${props.sessionId ?? ""}`,
  );
  const action = useWorkflowAction(
    async (
      operation: { type: "checkout"; planId: PlanId } | { type: "portal" },
    ) => {
      if (operation.type === "checkout") {
        const session = await props.createCheckout(operation.planId);
        if (!session.clientSecret)
          throw new Error("Stripe did not return a checkout form.");
        return {
          type: "checkout" as const,
          clientSecret: session.clientSecret,
        };
      }
      const result = await props.createPortal();
      const url = typeof result === "string" ? result : result.url;
      if (!url) throw new Error("Stripe did not return a billing portal URL.");
      return { type: "portal" as const, url };
    },
    props.scopeKey,
  );
  return {
    clientSecret:
      action.result?.type === "checkout"
        ? action.result.clientSecret
        : undefined,
    isPending: action.isPending,
    error: action.error ?? confirmation.error,
    choose: (planId: PlanId) => action.run({ type: "checkout", planId }),
    openPortal: async () => {
      const result = await action.run({ type: "portal" });
      if (result?.type === "portal")
        (props.onNavigate ?? ((url) => window.location.assign(url)))(
          result.url,
        );
    },
  };
}
export type BillingPlan<PlanId extends string = string> = {
  id: PlanId;
  name: string;
  monthlyAmount: number;
  currency: string;
  description?: string;
  feeDescription?: string;
};
export type BillingPlansProps<PlanId extends string = string> =
  PlanBillingOptions<PlanId> & {
    plans: BillingPlan<PlanId>[];
    publishableKey: string;
    currentPlanId?: PlanId;
    children?: (
      state: ReturnType<typeof usePlanBilling<PlanId>> & {
        plans: BillingPlan<PlanId>[];
      },
    ) => ReactNode;
  };
export function BillingPlans<PlanId extends string = string>(
  props: BillingPlansProps<PlanId>,
) {
  const state = usePlanBilling(props);
  if (props.children)
    return <>{props.children({ ...state, plans: props.plans })}</>;
  return (
    <section data-better-stripe="billing-plans" aria-busy={state.isPending}>
      <h2>Billing</h2>
      {state.error && <p role="alert">{state.error}</p>}
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void state.openPortal();
        }}
      >
        {state.isPending ? "Loading…" : "Manage billing"}
      </button>
      {props.plans.length ? (
        props.plans.map((plan) => (
          <article key={plan.id}>
            <h3>{plan.name}</h3>
            <p>{formatPrice(plan.monthlyAmount, plan.currency)}/month</p>
            {plan.description && <p>{plan.description}</p>}
            {plan.feeDescription && <p>{plan.feeDescription}</p>}
            <button
              type="button"
              disabled={state.isPending || plan.id === props.currentPlanId}
              onClick={() => {
                void state.choose(plan.id);
              }}
            >
              {plan.id === props.currentPlanId ? "Current plan" : "Choose plan"}
            </button>
          </article>
        ))
      ) : (
        <p>No billing plans configured.</p>
      )}
      {state.clientSecret && (
        <EmbeddedCheckout
          publishableKey={props.publishableKey}
          clientSecret={state.clientSecret}
        />
      )}
    </section>
  );
}
