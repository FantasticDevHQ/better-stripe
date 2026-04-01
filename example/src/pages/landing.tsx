import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IntervalSelector, PriceBadge } from "@getdojo/better-stripe/react";
import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../../convex/_generated/api";

export function Landing() {
  const navigate = useNavigate();
  const [interval, setInterval] = useState<"month" | "year">("month");

  const productsWithPrices = useQuery(api.queries.listProductsWithPrices);

  // Flatten all active prices from all active products
  const allPrices =
    productsWithPrices
      ?.filter((p) => p.active)
      .flatMap((product) =>
        product.prices
          .filter((price) => price.active)
          .map((price) => ({
            ...price,
            productName: product.name,
          })),
      ) ?? [];

  // Filter by selected interval (show recurring prices for the interval + one-time prices)
  const filteredPrices = allPrices.filter(
    (p) => p.interval === interval || p.type === "one_time",
  );

  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="space-y-4 py-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight">
          Premium tees, made for you
        </h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-lg">
          Get premium tees or start selling as a partner. Subscribe for
          exclusive drops and early access.
        </p>
      </div>

      {/* Pricing */}
      <div className="mx-auto max-w-4xl space-y-8">
        <h2 className="text-center text-3xl font-bold">
          Simple, transparent pricing
        </h2>

        <div className="flex justify-center">
          <IntervalSelector
            value={interval}
            onChange={setInterval}
            monthLabel="Monthly"
            yearLabel="Yearly"
          />
        </div>

        {productsWithPrices === undefined ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-40" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-10 w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : filteredPrices.length === 0 ? (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              No prices available yet. Check back soon.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {filteredPrices.map((price) => (
              <Card key={price._id}>
                <CardHeader>
                  <CardTitle>{price.productName}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <PriceBadge
                    unitAmount={price.unitAmount}
                    currency={price.currency}
                    interval={
                      price.type === "one_time"
                        ? null
                        : (price.interval ?? null)
                    }
                  />

                  {typeof price.metadata?.trialDays === "string" && (
                    <p className="text-muted-foreground text-sm">
                      {price.metadata.trialDays}-day free trial
                    </p>
                  )}
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    onClick={() =>
                      navigate(`/checkout?priceId=${price.stripePriceId}`)
                    }
                  >
                    Get Started
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
