import { Link } from "react-router-dom";
import type { UsageConfigurationValue } from "@fantastic.dev/better-stripe/usage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { money } from "@/lib/metered-money";
export function MeteredStorefrontProducts({
  products,
}: {
  products: {
    name: string;
    storeName: string;
    metered: { offerId: string; baseAmount: number; configurationJson: string };
  }[];
}) {
  if (!products.length) return null;
  return (
    <section aria-label="Metered memberships" className="space-y-4">
      <h2 className="text-2xl font-semibold">
        Coaching memberships & metered services
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const config = JSON.parse(
            product.metered.configurationJson,
          ) as UsageConfigurationValue;
          return (
            <Card key={product.metered.offerId}>
              <CardHeader>
                <p className="text-sm text-muted-foreground">
                  {product.storeName}
                </p>
                <CardTitle>{product.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-xl font-semibold">
                    {money(product.metered.baseAmount)} / month
                  </p>
                  {config.plan.model === "included_overage" && (
                    <p>
                      {config.plan.includedQuantity} {config.plan.unit.name}s
                      included per month
                    </p>
                  )}
                  <p>
                    {money(Number(config.plan.rate.unitAmountDecimal))} per{" "}
                    {config.plan.unit.name}
                    {config.plan.model === "included_overage"
                      ? " after included usage"
                      : " used"}
                  </p>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      aria-label={`Review ${product.name} membership`}
                      to={`/demo/metered-usage?offer=${product.metered.offerId}`}
                    />
                  }
                >
                  Review membership
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
