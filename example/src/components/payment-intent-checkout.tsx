import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { StripeProvider } from "@fantastic.dev/better-stripe/react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
export function PaymentIntentCheckout({
  priceId,
  referralCode,
  publishableKey,
}: {
  priceId: string;
  referralCode?: string;
  publishableKey: string;
}) {
  const { currentUser } = useRole();
  const create = useAction(api.checkoutExamples.createPaymentIntent);
  const [requestId] = useState(() => crypto.randomUUID());
  const started = useRef(false);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void create({
      stripePriceId: priceId,
      userId: currentUser.id ? (currentUser.id as Id<"users">) : undefined,
      referralCode,
      requestId,
    })
      .then((result) => setSecret(result.clientSecret))
      .catch((error: unknown) => setError(String(error)));
  }, [create, priceId, currentUser.id, referralCode, requestId]);
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Payment Intent unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!secret) return <p role="status">Creating payment…</p>;
  return (
    <StripeProvider
      publishableKey={publishableKey}
      elementsOptions={{ clientSecret: secret }}
    >
      <IntentForm />
    </StripeProvider>
  );
}
function IntentForm() {
  const { currentUser } = useRole();
  const [email, setEmail] = useState(currentUser.email);
  const stripe = useStripe();
  const elements = useElements();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setIsPending(true);
    setError(undefined);
    try {
      const validation = await elements.submit();
      if (validation.error)
        throw new Error(
          validation.error.message ?? "Check your payment details.",
        );
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/status`,
          payment_method_data: { billing_details: { email } },
        },
        redirect: "if_required",
      });
      if (result.error) setError(result.error.message ?? "Payment failed.");
      else if (result.paymentIntent)
        window.location.assign(
          `/checkout/status?payment_intent=${result.paymentIntent.id}`,
        );
    } catch (error) {
      setError(String(error));
    } finally {
      setIsPending(false);
    }
  }
  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="payment-email">Email</Label>
        <Input
          id="payment-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <PaymentElement />
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={!stripe || !elements || isPending}>
        {isPending ? "Processing…" : "Pay"}
      </Button>
    </form>
  );
}
