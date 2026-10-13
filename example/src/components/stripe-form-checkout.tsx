import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutFormProvider,
  CheckoutForm,
  useCheckoutForm,
} from "@stripe/react-stripe-js/checkout";
export function StripeFormCheckout({
  publishableKey,
  clientSecret,
  returnUrl,
}: {
  publishableKey: string;
  clientSecret: string;
  returnUrl: string;
}) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <CheckoutFormProvider stripe={stripe} options={{ clientSecret }}>
      <Form returnUrl={returnUrl} />
    </CheckoutFormProvider>
  );
}
function Form({ returnUrl }: { returnUrl: string }) {
  const checkout = useCheckoutForm();
  const [error, setError] = useState<string>();
  if (checkout.type === "loading")
    return <p role="status">Loading embedded form…</p>;
  if (checkout.type === "error")
    return <p role="alert">{checkout.error.message}</p>;
  return (
    <div className="space-y-3">
      <CheckoutForm
        onLoadError={({ error }) => setError(error.message)}
        onConfirm={async (event) => {
          try {
            const result = await checkout.checkout.confirm({
              formConfirmEvent: event,
            });
            if (result.type === "error") setError(result.error.message);
            else
              window.location.assign(
                returnUrl.replace(
                  "{CHECKOUT_SESSION_ID}",
                  checkout.checkout.id,
                ),
              );
          } catch (error) {
            setError(String(error));
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
