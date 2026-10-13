import { CheckoutFrame } from "@/components/checkout-frame";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCheckoutReturnUrl } from "@/lib/checkout-return-url";
import { ChargeSummary, Checkout } from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { CheckCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

function formatCurrency(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function Figure({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function DestinationChargeCheckoutForm({
  userId,
  stripePriceId,
  destinationAccountId,
  amount,
  publishableKey,
}: {
  userId: string;
  stripePriceId: string;
  destinationAccountId: string;
  amount: number;
  publishableKey: string;
}) {
  const createCheckout = useAction(
    api.marketplace.createDestinationChargeCheckout,
  );
  const returnUrl = buildCheckoutReturnUrl(
    window.location.origin,
    "/demo/destination-charge",
  );
  return (
    <Checkout
      mode="embedded"
      orderKey={`${userId}:${stripePriceId}:${destinationAccountId}`}
      publishableKey={publishableKey}
      returnUrl={returnUrl}
      createSession={() =>
        createCheckout({
          userId,
          stripePriceId,
          destinationAccountId,
          amount,
          returnUrl,
        })
      }
    >
      {(state) => <CheckoutFrame {...state} />}
    </Checkout>
  );
}

/**
 * BTS-58: destination charge + platform fee demo (single recipient). A buyer
 * buys a seeded store's one-time price as a plain destination charge — funds
 * route to the seller, the platform keeps its fee — and the resulting
 * fee/payout breakdown is shown, reconciling exactly to the charge amount.
 *
 * Unlike BTS-42 (recurring, two-page redirect) and BTS-43 (multi-recipient
 * split), this is the simplest case: one seller, one one-time charge, no
 * affiliate routing. The breakdown is computed from the known price up front
 * (`getDestinationChargeDemoContext`) rather than read back from a ledger —
 * a fixed one-time price has no proration, so the eventual charge amount is
 * never in question.
 */
export function DestinationChargeDemo() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const context = useQuery(api.marketplace.getDestinationChargeDemoContext);
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const session = useQuery(
    api.queries.getCheckoutSessionByStripeId,
    sessionId ? { stripeSessionId: sessionId } : "skip",
  );

  if (context === undefined || !publishableKey) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardContent padding="lg">
            <div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (context === null) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <Alert>
          <AlertTitle>No data found</AlertTitle>
          <AlertDescription>
            The marketplace demo is not seeded. Run the marketplace seed (with a
            live Stripe key) to create the buyer, store, and catalog:{" "}
            <code className="bg-muted rounded px-1">
              pnpm --filter ./example run setup
            </code>
            .
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { buyer, store, price, feePercent, breakdown } = context;
  const isComplete = session?.status === "complete";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          Buy from {store.storeName} — destination charge
        </h1>
        <p className="text-muted-foreground">
          {buyer.name} buys {store.storeName}'s one-time product as a real
          destination charge — funds route to the seller and the platform keeps
          its fee, in a single charge (no affiliate split).
        </p>
      </div>

      <Card>
        <CardContent padding="lg">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Price</span>
              <span className="font-medium">
                {formatCurrency(price.unitAmount, price.currency)}
              </span>
            </div>
            <div className="text-muted-foreground flex justify-between text-sm">
              <span>Platform fee</span>
              <span>{feePercent}% application fee</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run the sale</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionId ? (
            session === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : isComplete ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-5 w-5 text-success" />
                <span>Charge complete — see the breakdown below.</span>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Payment is being processed...
              </p>
            )
          ) : (
            <DestinationChargeCheckoutForm
              userId={buyer.id}
              stripePriceId={price.stripePriceId}
              destinationAccountId={store.stripeAccountId}
              amount={price.unitAmount}
              publishableKey={publishableKey}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee + payout breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isComplete && (
              <Badge data-testid="charge-complete-badge">Charge complete</Badge>
            )}
            <ChargeSummary
              {...breakdown}
              currency={price.currency}
              feeLabel={`Platform fee (${feePercent}%)`}
            >
              {({ metrics }) => (
                <div className="grid grid-cols-3 gap-4">
                  {metrics.map((metric) => (
                    <Figure
                      key={metric.key}
                      label={metric.label}
                      value={metric.formattedAmount}
                      testId={
                        metric.key === "gross"
                          ? "charged-amount"
                          : metric.key === "fee"
                            ? "platform-fee-amount"
                            : "seller-payout-amount"
                      }
                    />
                  ))}
                </div>
              )}
            </ChargeSummary>
            {breakdown.reconciles ? (
              <p className="text-muted-foreground text-sm">
                Fee + seller payout reconciles exactly to the charge amount.
              </p>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Breakdown does not reconcile</AlertTitle>
                <AlertDescription>
                  Fee + payout does not equal the charge amount — this should
                  never happen.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
