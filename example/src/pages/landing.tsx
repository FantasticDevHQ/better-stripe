import { MeteredStorefrontProducts } from "@/components/metered-storefront-products";
import { Storefront } from "@fantastic.dev/better-stripe/react";
import { EmptyState } from "@/components/empty-state";
import { useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import { isAffiliateReferral } from "../../convex/marketplace/affiliateSplit";
export function Landing() {
  const stores = useQuery(api.storefront.public.queries.listStores);
  const [params] = useSearchParams();
  const { currentRole } = useRole();
  const referral = params.get("ref");
  const canBuy = currentRole === "customer" || currentRole === "visitor";
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Shop our sellers</h1>
        <p className="text-muted-foreground">
          Buy directly from a seller. Choose a one-time purchase or a
          subscription. Guests are welcome.
        </p>
      </div>
      {isAffiliateReferral(referral) && (
        <Alert>
          <AlertDescription>
            Referred by Avery Affiliate. Avery earns a commission based on the
            seller's affiliate settings after the sale fee, at no extra cost to
            you.
          </AlertDescription>
        </Alert>
      )}
      {!canBuy && (
        <p className="text-muted-foreground">
          Choose Customer or Visitor above to make a purchase.
        </p>
      )}
      <MeteredStorefrontProducts
        products={(stores ?? []).flatMap((store) =>
          store.products.flatMap((product) =>
            product.metered
              ? [
                  {
                    name: product.name,
                    storeName: store.name,
                    metered: product.metered,
                  },
                ]
              : [],
          ),
        )}
      />
      <Storefront
        stores={stores}
        storeId={params.get("store") ?? undefined}
        referralCode={referral ?? undefined}
        canPurchase={canBuy}
        getCheckoutUrl={({ price, referralCode }) => {
          const query = new URLSearchParams({ priceId: price.stripePriceId });
          if (referralCode) query.set("ref", referralCode);
          return `/checkout?${query}`;
        }}
      >
        {(state) =>
          state.isLoading ? (
            <div role="status" aria-label="Loading stores">
              <Skeleton className="h-48 w-full" />
            </div>
          ) : state.isEmpty ? (
            <Alert>
              <AlertDescription>
                <EmptyState>No stores are available yet.</EmptyState>
              </AlertDescription>
            </Alert>
          ) : (
            state.stores.map((store) => (
              <section key={store.accountId} className="space-y-4">
                <h2 className="text-2xl font-semibold">{store.name}</h2>
                {!state.cards.some(
                  (card) => card.store.accountId === store.accountId,
                ) && (
                  <p className="text-muted-foreground">
                    No products available yet.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {state.cards
                    .filter((card) => card.store.accountId === store.accountId)
                    .map((card) => (
                      <Card key={card.price.stripePriceId}>
                        <CardHeader>
                          <CardTitle>{card.product.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <p className="text-muted-foreground text-sm">
                              {card.product.description}
                            </p>
                            <p className="text-xl font-semibold">
                              {card.formattedPrice}
                              {card.price.type === "one_time"
                                ? " one time"
                                : ""}
                            </p>
                          </div>
                        </CardContent>
                        <CardFooter>
                          {canBuy ? (
                            <Button
                              nativeButton={false}
                              role="link"
                              render={
                                <Link
                                  to={card.checkoutUrl!}
                                  aria-label={card.accessibilityLabel}
                                />
                              }
                            >
                              {card.purchaseLabel}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              Switch to Customer or Visitor to buy
                            </span>
                          )}
                        </CardFooter>
                      </Card>
                    ))}
                </div>
              </section>
            ))
          )
        }
      </Storefront>
    </div>
  );
}
