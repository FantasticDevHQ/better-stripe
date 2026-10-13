import { useState, type FormEvent } from "react";
import {
  CheckoutSessionProvider,
  PaymentElement,
  useCheckoutSession,
} from "@fantastic.dev/better-stripe/react";
import { useCheckout } from "@stripe/react-stripe-js/checkout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRole } from "@/providers/role-context";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function CustomCheckout({
  publishableKey,
  clientSecret,
  returnUrl,
}: {
  publishableKey: string;
  clientSecret: string;
  returnUrl: string;
}) {
  return (
    <CheckoutSessionProvider
      publishableKey={publishableKey}
      clientSecret={clientSecret}
    >
      <CustomForm returnUrl={returnUrl} />
    </CheckoutSessionProvider>
  );
}
function CustomForm({ returnUrl }: { returnUrl: string }) {
  const checkout = useCheckoutSession();
  const stripeCheckout = useCheckout();
  const { currentUser } = useRole();
  const [email, setEmail] = useState(currentUser.email);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stripeCheckout.type !== "success" || checkout.type !== "success")
      return;
    setIsPending(true);
    setError(null);
    try {
      const updated = await stripeCheckout.checkout.updateEmail(email);
      if (updated.type === "error") throw new Error(updated.error.message);
      const result = await checkout.confirm();
      if (result.type === "error") setError(result.message);
      else
        window.location.assign(
          returnUrl.replace("{CHECKOUT_SESSION_ID}", checkout.sessionId),
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setIsPending(false);
    }
  }
  if (checkout.type === "loading")
    return <p role="status">Loading checkout…</p>;
  if (checkout.type === "error")
    return (
      <Alert variant="destructive">
        <AlertTitle>Checkout unavailable</AlertTitle>
        <AlertDescription>{checkout.message}</AlertDescription>
      </Alert>
    );
  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="checkout-email">Email for your receipt</Label>
        <Input
          id="checkout-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <PaymentElement />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={isPending || stripeCheckout.type !== "success"}
      >
        {isPending ? "Processing…" : "Pay"}
      </Button>
      <p className="text-sm text-muted-foreground">
        A custom form using CheckoutSessionProvider, PaymentElement, and
        useCheckoutSession. Stripe securely collects payment details.
      </p>
    </form>
  );
}
