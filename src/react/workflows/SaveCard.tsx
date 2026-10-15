"use client";
import { useState, type ReactNode } from "react";
import { PaymentElement } from "@stripe/react-stripe-js";
import {
  StripeProvider,
  type StripeProviderProps,
} from "../components/StripeProvider.js";
import { useConfirmPayment } from "../hooks/useConfirmPayment.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type SaveCardFormState = {
  paymentElement: ReactNode;
  consent: boolean;
  setConsent: (value: boolean) => void;
  submit: () => Promise<void>;
  isPending: boolean;
  error: string | null;
};
export type SaveCardProps = Pick<
  StripeProviderProps,
  "publishableKey" | "appearance"
> & {
  scopeKey: string;
  requestId?: string;
  returnUrl: string;
  /** Authenticated callback authorizes customer, records usage consent and durable request identity. */
  createSetupIntent: (request: {
    requestId: string;
  }) => Promise<{ setupIntentId: string; clientSecret: string }>;
  onSuccess?: (setupIntentId: string) => void;
  renderForm?: (state: SaveCardFormState) => ReactNode;
};
/** Unstyled card setup. Host owns usage disclosures and authorization. */
export function SaveCard(props: SaveCardProps) {
  return (
    <SaveCardBody
      key={`${props.scopeKey}:${props.requestId ?? ""}`}
      {...props}
    />
  );
}
function SaveCardBody(props: SaveCardProps) {
  const [requestId] = useState(() => props.requestId ?? crypto.randomUUID());
  const state = useWorkflowResource(() =>
    props.createSetupIntent({ requestId }),
  );
  if (state.error)
    return (
      <div role="alert">
        {state.error}
        <button type="button" onClick={state.refresh}>
          Retry
        </button>
      </div>
    );
  if (!state.data || state.isLoading)
    return <p role="status">Preparing card setup…</p>;
  return (
    <StripeProvider
      publishableKey={props.publishableKey}
      appearance={props.appearance}
      elementsOptions={{ clientSecret: state.data.clientSecret }}
    >
      <SaveCardForm {...props} setupIntentId={state.data.setupIntentId} />
    </StripeProvider>
  );
}
function SaveCardForm(props: SaveCardProps & { setupIntentId: string }) {
  const { confirmSetup, isReady, hasElements } = useConfirmPayment();
  const [consent, setConsent] = useState(false);
  const action = useWorkflowAction(async () => {
    if (!consent) throw new Error("Consent is required to save this card.");
    const result = await confirmSetup(props.returnUrl, "always");
    if (!result.success) throw new Error(result.error);
    return true;
  });
  const state: SaveCardFormState = {
    paymentElement: <PaymentElement />,
    consent,
    setConsent,
    submit: async () => {
      const saved = await action.run();
      if (saved) props.onSuccess?.(props.setupIntentId);
    },
    isPending:
      action.isPending ||
      !isReady ||
      !hasElements ||
      action.result !== undefined,
    error: action.error,
  };
  if (props.renderForm) return <>{props.renderForm(state)}</>;
  return (
    <div>
      {state.paymentElement}
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Save this card for future payments and show it at checkout.
      </label>
      {state.error && <p role="alert">{state.error}</p>}
      <button
        type="button"
        disabled={!consent || state.isPending}
        onClick={() => void state.submit()}
      >
        Save card
      </button>
    </div>
  );
}
