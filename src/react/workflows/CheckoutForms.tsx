"use client";
import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import {
  PaymentElement as IntentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  PaymentElement,
  useCheckout,
  CheckoutFormProvider,
  CheckoutForm as StripeCheckoutForm,
  useCheckoutForm,
} from "@stripe/react-stripe-js/checkout";
import { CheckoutSessionProvider } from "../components/CheckoutSessionProvider.js";
import { StripeProvider } from "../components/StripeProvider.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type CheckoutFormState = {
  email: string;
  setEmail: (email: string) => void;
  emailInputId: string;
  isPending: boolean;
  error: string | null;
  paymentElement: ReactNode;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};
export type CheckoutFormOptions = {
  email?: string;
  appearance?: Appearance;
  renderForm?: (state: CheckoutFormState) => ReactNode;
};
export type CheckoutFormProps = CheckoutFormOptions & {
  publishableKey: string;
  clientSecret: string;
  returnUrl: string;
  onNavigate: (url: string) => void;
};
function NativeForm({
  email,
  setEmail,
  emailInputId,
  paymentElement,
  submit,
  isPending,
  error,
}: CheckoutFormState) {
  return (
    <form
      onSubmit={submit}
      data-better-stripe="checkout-form"
      aria-busy={isPending}
    >
      <label htmlFor={emailInputId}>Email for your receipt</label>
      <input
        id={emailInputId}
        type="email"
        name="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {paymentElement}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={isPending}>
        {isPending ? "Processing…" : "Pay"}
      </button>
    </form>
  );
}
export function CheckoutElementsForm(props: CheckoutFormProps) {
  return (
    <CheckoutSessionProvider
      publishableKey={props.publishableKey}
      clientSecret={props.clientSecret}
      appearance={props.appearance}
    >
      <SessionForm {...props} />
    </CheckoutSessionProvider>
  );
}
function SessionForm({
  email: initialEmail = "",
  returnUrl,
  onNavigate,
  renderForm,
}: CheckoutFormProps) {
  const checkout = useCheckout();
  const [email, setEmail] = useState(initialEmail);
  const emailInputId = useId();
  const action = useWorkflowAction(async () => {
    if (checkout.type !== "success") throw new Error("Checkout is not ready.");
    const updated = await checkout.checkout.updateEmail(email);
    if (updated.type === "error") throw new Error(updated.error.message);
    const confirmed = await checkout.checkout.confirm();
    if (confirmed.type === "error") throw new Error(confirmed.error.message);
    onNavigate(
      returnUrl.replace("{CHECKOUT_SESSION_ID}", checkout.checkout.id),
    );
  });
  if (checkout.type === "loading")
    return <p role="status">Loading checkout…</p>;
  if (checkout.type === "error")
    return <p role="alert">{checkout.error.message}</p>;
  const state: CheckoutFormState = {
    email,
    setEmail,
    emailInputId,
    paymentElement: <PaymentElement />,
    error: action.error,
    isPending: action.isPending,
    submit: (event) => {
      event.preventDefault();
      void action.run();
    },
  };
  return <>{renderForm ? renderForm(state) : <NativeForm {...state} />}</>;
}
export function PaymentIntentForm(props: CheckoutFormProps) {
  return (
    <StripeProvider
      publishableKey={props.publishableKey}
      elementsOptions={{
        clientSecret: props.clientSecret,
        ...(props.appearance ? { appearance: props.appearance } : {}),
      }}
    >
      <IntentForm {...props} />
    </StripeProvider>
  );
}
function IntentForm({
  email: initialEmail = "",
  returnUrl,
  onNavigate,
  renderForm,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const emailInputId = useId();
  const [email, setEmail] = useState(initialEmail);
  const action = useWorkflowAction(async () => {
    if (!stripe || !elements)
      throw new Error("Payment details are still loading.");
    const validation = await elements.submit();
    if (validation.error)
      throw new Error(
        validation.error.message ?? "Check your payment details.",
      );
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl,
        payment_method_data: { billing_details: { email } },
      },
      redirect: "if_required",
    });
    if (result.error)
      throw new Error(result.error.message ?? "Payment failed.");
    if (result.paymentIntent) {
      const url = new URL(returnUrl, window.location.origin);
      url.searchParams.set("payment_intent", result.paymentIntent.id);
      onNavigate(url.toString());
    }
  });
  const state: CheckoutFormState = {
    email,
    setEmail,
    emailInputId,
    paymentElement: <IntentElement />,
    error: action.error,
    isPending: action.isPending || !stripe || !elements,
    submit: (event) => {
      event.preventDefault();
      void action.run();
    },
  };
  return <>{renderForm ? renderForm(state) : <NativeForm {...state} />}</>;
}
export function CheckoutForm(props: CheckoutFormProps) {
  const stripe = useMemo(
    () => loadStripe(props.publishableKey),
    [props.publishableKey],
  );
  return (
    <CheckoutFormProvider
      stripe={stripe}
      options={{
        clientSecret: props.clientSecret,
        ...(props.appearance
          ? { elementsOptions: { appearance: props.appearance } }
          : {}),
      }}
    >
      <CompactForm {...props} />
    </CheckoutFormProvider>
  );
}
function CompactForm({ returnUrl, onNavigate }: CheckoutFormProps) {
  const checkout = useCheckoutForm();
  const [loadError, setLoadError] = useState<string | null>(null);
  const action = useWorkflowAction(
    async (
      event: Parameters<
        NonNullable<
          React.ComponentProps<typeof StripeCheckoutForm>["onConfirm"]
        >
      >[0],
    ) => {
      if (checkout.type !== "success")
        throw new Error("Checkout is not ready.");
      const result = await checkout.checkout.confirm({
        formConfirmEvent: event,
      });
      if (result.type === "error") throw new Error(result.error.message);
      onNavigate(
        returnUrl.replace("{CHECKOUT_SESSION_ID}", checkout.checkout.id),
      );
    },
  );
  if (checkout.type === "loading")
    return <p role="status">Loading embedded form…</p>;
  if (checkout.type === "error")
    return <p role="alert">{checkout.error.message}</p>;
  return (
    <div data-better-stripe="checkout-form" aria-busy={action.isPending}>
      <StripeCheckoutForm
        onLoadError={({ error }) =>
          setLoadError(error.message ?? "Could not load checkout.")
        }
        onConfirm={async (event) => {
          await action.run(event);
        }}
      />
      {(loadError || action.error) && (
        <p role="alert">{loadError || action.error}</p>
      )}
    </div>
  );
}
