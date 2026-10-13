import { CheckoutChooser } from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { SessionCheckout } from "@/components/session-checkout";
import { PaymentIntentCheckout } from "@/components/payment-intent-checkout";
export function CheckoutTypeExamples({
  priceId,
  referralCode,
  publishableKey,
}: {
  priceId: string;
  referralCode?: string;
  publishableKey: string;
}) {
  const [params, setParams] = useSearchParams();
  const { currentUser } = useRole();
  const price = useQuery(api.checkoutExamples.describePrice, {
    stripePriceId: priceId,
  });
  const requested = params.get("checkout") ?? "embedded";
  if (price === undefined)
    return <p role="status">Loading checkout options…</p>;
  if (price === null)
    return (
      <EmptyState>
        This price is no longer available. Choose another product from Stores.
      </EmptyState>
    );
  return (
    <CheckoutChooser
      value={
        requested as import("@fantastic.dev/better-stripe/react").CheckoutMode
      }
      recurring={price.type === "recurring"}
      onValueChange={(mode) => {
        const next = new URLSearchParams(params);
        next.set("checkout", mode);
        setParams(next, { replace: true });
      }}
    >
      {({ options: CHECKOUT_TYPES, selected, unsupported, select }) => (
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Choose your checkout type</h2>
            <p className="text-sm text-muted-foreground">
              Stripe.js uses your publishable key in the browser. Your server
              uses the secret key to create a Checkout Session or PaymentIntent.
              Connect embeds manage seller accounts; they are not shopper
              checkout forms.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {CHECKOUT_TYPES.map((type) => (
              <Card key={type.id}>
                <CardHeader>
                  <CardTitle>{type.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    variant={type.id === selected.id ? "default" : "outline"}
                    aria-pressed={type.id === selected.id}
                    onClick={() => {
                      select(type.id);
                    }}
                  >
                    {type.id === selected.id ? "Selected" : "Choose"}{" "}
                    {type.title}
                  </Button>
                  {type.id === "form" && (
                    <div className="mt-2">
                      <Badge variant="secondary">Preview</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{selected.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{selected.api}</p>
                <dl className="space-y-3">
                  <div>
                    <dt className="font-medium">Pros</dt>
                    <dd className="text-sm text-muted-foreground">
                      {selected.pros}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Cons</dt>
                    <dd className="text-sm text-muted-foreground">
                      {selected.cons}
                    </dd>
                  </div>
                </dl>
                <a
                  className="text-sm underline"
                  href={selected.docs}
                  target="_blank"
                  rel="noreferrer"
                >
                  Stripe documentation
                </a>
              </div>
            </CardContent>
          </Card>
          {price && (
            <p className="font-medium">
              {price.name} ·{" "}
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: price.currency,
              }).format(price.amount / 100)}
              {price.type === "recurring" ? " per billing period" : ""}
            </p>
          )}
          {unsupported ? (
            <p role="status">
              Payment Intents alone do not create subscriptions. Choose a
              Checkout Sessions example above for this recurring product.
            </p>
          ) : selected.id === "payment-intent" ? (
            <PaymentIntentCheckout
              key={`${selected.id}:${priceId}:${currentUser.id}:${referralCode ?? ""}`}
              priceId={priceId}
              referralCode={referralCode}
              publishableKey={publishableKey}
            />
          ) : (
            <SessionCheckout
              key={`${selected.id}:${priceId}:${currentUser.id}:${referralCode ?? ""}`}
              mode={selected.id}
              priceId={priceId}
              userId={
                currentUser.id ? (currentUser.id as Id<"users">) : undefined
              }
              referralCode={referralCode}
              publishableKey={publishableKey}
            />
          )}
        </div>
      )}
    </CheckoutChooser>
  );
}
