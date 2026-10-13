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
import { isAffiliateReferral } from "../../convex/affiliateSplit";

export function Landing() {
  const stores = useQuery(api.storefront.listStores);
  const [params] = useSearchParams();
  const { currentRole } = useRole();
  const referral = params.get("ref");
  const storeId = params.get("store");
  const visibleStores = stores?.filter(
    (store) => !storeId || store.accountId === storeId,
  );
  const canBuy = currentRole === "visitor" || currentRole === "customer";
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-3 py-8">
        <h1 className="text-4xl font-bold">Shop our sellers</h1>
        <p className="text-muted-foreground">
          Buy directly from a seller. Choose a one-time purchase or a
          subscription. Guests are welcome.
        </p>
      </div>
      {isAffiliateReferral(referral) && (
        <Alert>
          <AlertDescription>
            Referred by Avery Affiliate. Avery earns 20% of the sale after the
            platform fee, at no extra cost to you.
          </AlertDescription>
        </Alert>
      )}
      {!canBuy && (
        <p className="text-muted-foreground">
          Choose Customer or Visitor above to make a purchase.
        </p>
      )}
      {stores === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : !visibleStores?.length ? (
        <Alert>
          <AlertDescription>
            <EmptyState>No stores are available yet.</EmptyState>
          </AlertDescription>
        </Alert>
      ) : (
        visibleStores.map((store) => (
          <section key={store.accountId} className="space-y-4">
            <h2 className="text-2xl font-semibold">{store.name}</h2>
            {!store.products.length && (
              <p className="text-muted-foreground">
                No products available yet.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {store.products.flatMap((product) =>
                product.prices.map((price) => {
                  const query = new URLSearchParams({
                    priceId: price.stripePriceId,
                  });
                  if (referral) query.set("ref", referral);
                  return (
                    <Card key={price.stripePriceId}>
                      <CardHeader>
                        <CardTitle>{product.name}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <p className="text-muted-foreground text-sm">
                            {product.description}
                          </p>
                          <p className="text-xl font-semibold">
                            {new Intl.NumberFormat("en-US", {
                              style: "currency",
                              currency: price.currency.toUpperCase(),
                            }).format(price.unitAmount / 100)}
                            {price.interval
                              ? ` / ${price.interval}`
                              : " one time"}
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
                                to={`/checkout?${query}`}
                                aria-label={`${price.type === "recurring" ? "Subscribe to" : "Buy"} ${product.name}`}
                              />
                            }
                          >
                            {price.type === "recurring"
                              ? "Subscribe"
                              : "Buy now"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            Switch to Customer or Visitor to buy
                          </span>
                        )}
                      </CardFooter>
                    </Card>
                  );
                }),
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
