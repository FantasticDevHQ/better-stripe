import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EmbeddedCheckout } from "@fantastic.dev/better-stripe/react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { buildCheckoutReturnUrl } from "@/lib/checkout-return-url";
import { CustomCheckout } from "@/components/custom-checkout";
import { StripeFormCheckout } from "@/components/stripe-form-checkout";
export function SessionCheckout({
  priceId,
  userId,
  publishableKey,
  referralCode,
  mode = "embedded",
}: {
  priceId: string;
  mode?: "custom" | "embedded" | "redirect" | "form";
  userId?: import("../../convex/_generated/dataModel").Id<"users">;
  referralCode?: string;
  publishableKey: string;
}) {
  const createCheckout = useAction(api.actions.createCheckoutSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasInitiated = useRef(false);

  const initCheckout = useCallback(async () => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;
    try {
      const session = await createCheckout({
        userId,
        uiMode: mode,
        referralCode,
        stripePriceId: priceId,
        returnUrl:
          mode === "redirect"
            ? `${window.location.origin}/checkout/status`
            : buildCheckoutReturnUrl(window.location.origin),
        cancelUrl: window.location.href,
      });
      if (mode === "redirect" && session.url) {
        setHostedUrl(session.url);
      } else if (session?.clientSecret) {
        setClientSecret(session.clientSecret);
      } else {
        setError(
          "Failed to create checkout session. No client secret returned.",
        );
      }
    } catch (err) {
      console.error("Checkout session error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create checkout session.",
      );
    }
  }, [createCheckout, userId, priceId, referralCode, mode]);

  // Kick off checkout-session creation once on mount. The `hasInitiated`
  // ref guard inside `initCheckout` keeps it idempotent under StrictMode's
  // double-invoked effects.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: creates the checkout session on mount
    void initCheckout();
  }, [initCheckout]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Checkout Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (hostedUrl)
    return (
      <Button onClick={() => window.location.assign(hostedUrl)}>
        Continue to Stripe Checkout
      </Button>
    );
  if (!clientSecret) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // No onComplete handler: Stripe substitutes the real session id into
  // return_url and redirects there itself (see buildCheckoutReturnUrl).
  if (mode === "form")
    return (
      <StripeFormCheckout
        publishableKey={publishableKey}
        clientSecret={clientSecret}
        returnUrl={buildCheckoutReturnUrl(window.location.origin)}
      />
    );
  if (mode === "custom")
    return (
      <CustomCheckout
        publishableKey={publishableKey}
        clientSecret={clientSecret}
        returnUrl={buildCheckoutReturnUrl(window.location.origin)}
      />
    );
  return (
    <EmbeddedCheckout
      publishableKey={publishableKey}
      clientSecret={clientSecret}
    />
  );
}
