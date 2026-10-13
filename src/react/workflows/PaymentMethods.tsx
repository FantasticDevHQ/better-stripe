"use client";
import { useState, type ReactNode } from "react";
import {
  PaymentMethodsList,
  type PaymentMethodItem,
} from "../components/PaymentMethodsList.js";
import { AddCardForm } from "../components/AddCardForm.js";
import { StripeProvider } from "../components/StripeProvider.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
export type PaymentMethodsActions = {
  scopeKey: string;
  load: () => Promise<PaymentMethodItem[]>;
  attach: (paymentMethodId: string) => Promise<unknown>;
  detach: (paymentMethodId: string) => Promise<unknown>;
};
export function usePaymentMethodsManager(props: PaymentMethodsActions) {
  const resource = useWorkflowResource(props.load, props.scopeKey);
  const [kind, setKind] = useState<"attach" | "detach">("attach");
  const action = useWorkflowAction(
    async (kind: "attach" | "detach", id: string) => {
      setKind(kind);
      if (!id.trim()) throw new Error("A payment method ID is required.");
      await props[kind](id);
      return true;
    },
    props.scopeKey,
  );
  const run = async (kind: "attach" | "detach", id: string) => {
    if (await action.run(kind, id)) resource.refresh();
  };
  return {
    methods: resource.data ?? [],
    isLoading: resource.isLoading,
    isPending: action.isPending,
    loadError: resource.error,
    attachError: kind === "attach" ? action.error : null,
    deleteError: kind === "detach" ? action.error : null,
    reload: resource.refresh,
    attach: (id: string) => run("attach", id),
    detach: (id: string) => run("detach", id),
  };
}
export function toPaymentMethodItem(
  method: {
    id: string;
    type: string;
    card?: {
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
    } | null;
  },
  defaultId?: string,
): PaymentMethodItem {
  return {
    id: method.id,
    type: method.type,
    card: method.card
      ? {
          brand: method.card.brand,
          last4: method.card.last4,
          expMonth: method.card.exp_month,
          expYear: method.card.exp_year,
        }
      : undefined,
    isDefault: method.id === defaultId,
  };
}
export type PaymentMethodsProps = PaymentMethodsActions & {
  publishableKey: string;
  children?: (state: ReturnType<typeof usePaymentMethodsManager>) => ReactNode;
};
export function PaymentMethods(props: PaymentMethodsProps) {
  return <PaymentMethodsBody key={props.scopeKey} {...props} />;
}
function PaymentMethodsBody(props: PaymentMethodsProps) {
  const state = usePaymentMethodsManager(props);
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section
      data-better-stripe="payment-methods"
      aria-busy={state.isPending || state.isLoading}
    >
      <h2>Payment methods</h2>
      <StripeProvider publishableKey={props.publishableKey}>
        <fieldset disabled={state.isPending}>
          <legend>Add a card</legend>
          <AddCardForm
            onSuccess={(id) => {
              void state.attach(id);
            }}
          />
        </fieldset>
      </StripeProvider>
      {(state.loadError || state.attachError || state.deleteError) && (
        <p role="alert">
          {state.loadError || state.attachError || state.deleteError}
        </p>
      )}
      <button type="button" disabled={state.isLoading} onClick={state.reload}>
        {state.isLoading ? "Loading…" : "Refresh"}
      </button>
      {state.isLoading ? (
        <p role="status">Loading payment methods…</p>
      ) : (
        <PaymentMethodsList
          methods={state.methods}
          onDelete={(id) => {
            void state.detach(id);
          }}
        />
      )}
    </section>
  );
}
