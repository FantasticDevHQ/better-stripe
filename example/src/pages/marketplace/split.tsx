import { CheckoutFrame } from "@/components/checkout-frame";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  Checkout,
  EarningsSummary,
  SplitBreakdown,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import {
  AFFILIATE_REFERRAL_CODE,
  DEMO_SALE_AMOUNT,
  isAffiliateReferral,
} from "../../../convex/marketplace/affiliateSplit";
import { buildSplitCheckoutReturnUrl } from "../../lib/split-checkout-return-url";
import { useEarnings, useSplitBreakdown } from "../../lib/stripe-hooks";

/**
 * Affiliate split breakdown demo (BTS-43) — the headline proof: one $100 sale,
 * three destinations. A buyer arrives via an affiliate referral (`?ref=avery`),
 * buys the store's one-time product, and the sale is routed store + affiliate,
 * with the platform taking its configured fee. The result is visualized with
 * the headless `SplitBreakdown` (store / affiliate / platform) and
 * `EarningsSummary` (the affiliate's ledger), driven by the `useSplitBreakdown`
 * / `useEarnings` hooks.
 *
 * The live split needs a seeded Convex + Stripe deployment (transfers are
 * created by the webhook engine after the charge). Without one the page still
 * boots and the panels show their loading/empty states.
 */
function SplitCheckoutForm({
  priceId,
  userId,
  referralCode,
  publishableKey,
}: {
  priceId: string;
  userId: string;
  referralCode: string | null;
  publishableKey: string;
}) {
  const createCheckout = useAction(
    api.marketplace.checkoutActions.createAffiliateSplitCheckout,
  );
  return (
    <Checkout
      mode="embedded"
      orderKey={`${userId}:${priceId}:${referralCode ?? ""}`}
      publishableKey={publishableKey}
      returnUrl={buildSplitCheckoutReturnUrl(window.location.origin)}
      createSession={({ requestId }) =>
        createCheckout({
          requestId,
          userId: userId
            ? (userId as import("../../../convex/_generated/dataModel").Id<"users">)
            : undefined,
          stripePriceId: priceId,
          referralCode: referralCode ?? undefined,
          returnUrl: buildSplitCheckoutReturnUrl(window.location.origin),
        })
      }
    >
      {(state) => <CheckoutFrame {...state} />}
    </Checkout>
  );
}

export function AffiliateSplitDemo() {
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get("ref");
  const { currentUser } = useRole();

  const personas = useQuery(
    api.marketplace.personaQueries.getMarketplacePersonas,
  );
  const publishableKey = useQuery(api.stripe.public.queries.getPublishableKey);
  const [showCheckout, setShowCheckout] = useState(false);

  const storeAccountId = personas?.store?.accountId ?? undefined;
  const affiliateAccountId = personas?.affiliate?.accountId ?? undefined;

  const catalog = useQuery(
    api.products.queries.listProductsWithPricesByAccount,
    storeAccountId ? { accountId: storeAccountId } : "skip",
  );
  const oneTimePrice = catalog
    ?.flatMap((product) => product.prices)
    .find((price) => price.type === "one_time");

  const attributed = isAffiliateReferral(referralCode) && !!personas?.affiliate;

  // The affiliate's ledger, and the most recent sale's charge (the split legs
  // carry the source charge id) — that drives the per-sale breakdown.
  const earnings = useEarnings(affiliateAccountId);
  const latestChargeId = [...earnings.transfers]
    .filter((t) => t.sourceChargeId)
    .sort(
      (a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0),
    )[0]?.sourceChargeId;
  const { breakdown, isLoading: splitLoading } = useSplitBreakdown({
    sourceChargeId: latestChargeId,
    saleAmount: DEMO_SALE_AMOUNT,
  });

  const referralLink = `/marketplace/split?ref=${AFFILIATE_REFERRAL_CODE}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          Affiliate Split — one sale, three ways
        </h1>
        <p className="text-muted-foreground">
          A $100 sale from {personas?.store?.name ?? "the store"} routed to
          store, affiliate, and platform. The affiliate is attributed from the{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 text-sm">?ref</code>{" "}
          referral parameter.
        </p>
      </div>

      {/* Attribution */}
      <Card>
        <CardContent padding="lg">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">Referral attribution</span>
              {attributed ? (
                <Badge data-testid="attribution-badge">
                  Referred by {personas?.affiliate?.name}
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid="attribution-badge">
                  No referral — store keeps the full net
                </Badge>
              )}
            </div>
            {!attributed && (
              <p className="text-muted-foreground text-sm">
                Add an affiliate:{" "}
                <Button
                  variant="link"
                  className="h-auto p-0"
                  nativeButton={false}
                  role="link"
                  render={
                    <Link to={referralLink} aria-label="Open affiliate link" />
                  }
                >
                  visit with ?ref={AFFILIATE_REFERRAL_CODE}
                </Button>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Run the sale */}
      <Card>
        <CardContent padding="lg">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Run a referred sale</h2>
            {personas === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : !storeAccountId || !oneTimePrice ? (
              <Alert>
                <AlertTitle>No data found</AlertTitle>
                <AlertDescription>
                  The marketplace is not seeded. Run <code>npm run setup</code>{" "}
                  to seed the marketplace personas and catalog, then reload.
                </AlertDescription>
              </Alert>
            ) : !showCheckout ? (
              <div className="space-y-3">
                <p className="text-sm">
                  One-time purchase — <strong>$100.00</strong> from{" "}
                  {personas.store?.name}.
                </p>
                <Button onClick={() => setShowCheckout(true)}>
                  Buy with test card
                </Button>
              </div>
            ) : !publishableKey ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <SplitCheckoutForm
                priceId={oneTimePrice.stripePriceId}
                userId={currentUser.id}
                referralCode={referralCode}
                publishableKey={publishableKey}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* The breakdown */}
      <Card>
        <CardContent padding="lg">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              Latest sale — split breakdown
            </h2>
            <SplitBreakdown
              breakdown={breakdown}
              isLoading={splitLoading}
              emptyLabel="No referred sale yet — complete a purchase above to see the split."
              className="[&_dt]:text-muted-foreground [&_dd]:font-medium [&>dl]:space-y-1 [&>dl>div]:flex [&>dl>div]:justify-between"
            />
            <Separator />
            <h2 className="text-lg font-semibold">Affiliate earnings</h2>
            <EarningsSummary
              gross={earnings.gross}
              reversed={earnings.reversed}
              net={earnings.net}
              payouts={earnings.payouts}
              paidOut={earnings.paidOut}
              isLoading={earnings.isLoading}
              emptyLabel="No affiliate earnings yet."
              className="[&_dt]:text-muted-foreground [&_dd]:font-medium [&>dl]:space-y-1"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
