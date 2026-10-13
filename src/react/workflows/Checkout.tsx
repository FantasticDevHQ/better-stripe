"use client";
import type { ReactNode } from "react";
import { EmbeddedCheckout } from "../components/EmbeddedCheckout.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
import {
  CheckoutElementsForm,
  PaymentIntentForm,
  CheckoutForm,
  type CheckoutFormOptions,
} from "./CheckoutForms.js";
export type CheckoutMode =
  "redirect" | "embedded" | "custom" | "form" | "payment-intent";
export type CheckoutSessionResult = {
  stripeSessionId: string;
  clientSecret?: string;
  url?: string;
};
export type CheckoutIntentResult = {
  paymentIntentId: string;
  clientSecret: string;
};
export type CheckoutRequest = {
  mode: Exclude<CheckoutMode, "payment-intent">;
  requestId: string;
};
export type CheckoutRenderProps = {
  content: ReactNode;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
  mode: CheckoutMode;
  hostedUrl?: string;
  continueToCheckout?: () => void;
};
type Common = CheckoutFormOptions & {
  publishableKey: string;
  /** Changes when the price, signed-in customer, or referral attribution changes. */
  orderKey: string;
  returnUrl: string;
  onNavigate?: (url: string) => void;
  children?: (state: CheckoutRenderProps) => ReactNode;
};
export type CheckoutProps = Common &
  (
    | {
        mode: Exclude<CheckoutMode, "payment-intent">;
        createSession: (
          request: CheckoutRequest,
        ) => Promise<CheckoutSessionResult>;
      }
    | {
        mode: "payment-intent";
        createPaymentIntent: (request: {
          requestId: string;
        }) => Promise<CheckoutIntentResult>;
      }
  );
/** All checkout integrations share one unstyled lifecycle. Callbacks must authenticate and validate prices on the server. */
export function Checkout(props: CheckoutProps) {
  return <CheckoutBody key={`${props.orderKey}:${props.mode}`} {...props} />;
}
function CheckoutBody(props: CheckoutProps) {
  const state = useWorkflowResource(async () => {
    const requestId = crypto.randomUUID();
    const result =
      props.mode === "payment-intent"
        ? await props.createPaymentIntent({ requestId })
        : await props.createSession({ mode: props.mode, requestId });
    if (props.mode === "redirect") {
      if (!("url" in result) || !result.url)
        throw new Error("Stripe did not return a checkout URL.");
    } else if (!result.clientSecret)
      throw new Error("Stripe did not return a checkout client secret.");
    return result;
  });
  const navigate =
    props.onNavigate ?? ((url: string) => window.location.assign(url));
  let content: ReactNode;
  if (state.error)
    content = (
      <div role="alert">
        <p>{state.error}</p>
        <button type="button" onClick={state.refresh}>
          Retry
        </button>
      </div>
    );
  else if (!state.data || state.isLoading)
    content = <p role="status">Creating checkout…</p>;
  else if (props.mode === "redirect" && "url" in state.data) {
    const url = state.data.url!;
    content = (
      <button type="button" onClick={() => navigate(url)}>
        Continue to Stripe Checkout
      </button>
    );
  } else {
    const form = {
      publishableKey: props.publishableKey,
      clientSecret: state.data.clientSecret!,
      returnUrl: props.returnUrl,
      email: props.email,
      appearance: props.appearance,
      renderForm: props.renderForm,
      onNavigate: navigate,
    };
    content =
      props.mode === "embedded" ? (
        <EmbeddedCheckout
          publishableKey={form.publishableKey}
          clientSecret={form.clientSecret}
        />
      ) : props.mode === "custom" ? (
        <CheckoutElementsForm {...form} />
      ) : props.mode === "form" ? (
        <CheckoutForm {...form} />
      ) : (
        <PaymentIntentForm {...form} />
      );
  }
  const hostedUrl =
    props.mode === "redirect" && state.data && "url" in state.data
      ? state.data.url
      : undefined;
  const result: CheckoutRenderProps = {
    content,
    isLoading: state.isLoading,
    error: state.error,
    retry: state.refresh,
    mode: props.mode,
    hostedUrl,
    continueToCheckout: hostedUrl ? () => navigate(hostedUrl) : undefined,
  };
  return <>{props.children ? props.children(result) : content}</>;
}
