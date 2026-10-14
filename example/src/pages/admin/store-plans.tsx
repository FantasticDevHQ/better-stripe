import { EmptyState } from "@/components/empty-state";
import { PlanPricingEditor } from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { useRole } from "@/providers/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
export function AdminStorePlans() {
  const { currentUser } = useRole();
  const plans = useQuery(api.storePlanPricing.list, {});
  const update = useAction(api.storePlanPricing.update);
  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Store plans</h1>
        <p className="text-muted-foreground">
          Set monthly USD prices, sale fees, and affiliate payouts for Starter,
          Growth, and Pro.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Monthly price changes apply to new subscriptions. Existing subscriptions
        keep their current price. Sale fee changes apply to future settlements.
        Sellers always cover actual Stripe processing costs.
      </p>
      {plans === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : plans.length === 0 ? (
        <EmptyState>
          No store plans are configured yet. Open Setup to initialize the
          example.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <PlanPricingEditor
                  plan={plan}
                  onSave={(values) =>
                    update({
                      ...values,
                      planId: plan.id,
                      adminId: currentUser.id as Id<"users">,
                    })
                  }
                >
                  {({
                    monthlyPrice,
                    saleFee,
                    affiliateShare,
                    setMonthlyPrice,
                    setSaleFee,
                    setAffiliateShare,
                    save,
                    isPending,
                    error,
                    message,
                  }) => (
                    <form
                      aria-label={`${plan.name} pricing`}
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor={`${plan.id}-monthly`}>
                          Monthly price (USD)
                        </Label>
                        <Input
                          id={`${plan.id}-monthly`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          inputMode="decimal"
                          value={monthlyPrice}
                          disabled={isPending}
                          onChange={(event) =>
                            setMonthlyPrice(event.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${plan.id}-fee`}>Sale fee (%)</Label>
                        <Input
                          id={`${plan.id}-fee`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          inputMode="decimal"
                          value={saleFee}
                          disabled={isPending}
                          placeholder="Stripe processing only"
                          onChange={(event) => setSaleFee(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank for Stripe processing only. Otherwise, the
                          seller pays the greater of this percentage or actual
                          processing.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${plan.id}-affiliate`}>
                          Affiliate payout (%)
                        </Label>
                        <Input
                          id={`${plan.id}-affiliate`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          required
                          inputMode="decimal"
                          value={affiliateShare}
                          disabled={isPending}
                          onChange={(event) =>
                            setAffiliateShare(event.target.value)
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Share of a referred sale after the sale fee. The
                          seller receives the remainder. Applies to future
                          settlements.
                        </p>
                      </div>
                      {error && (
                        <p role="alert" className="text-sm text-destructive">
                          {error}
                        </p>
                      )}
                      {message && (
                        <p
                          role="status"
                          className="text-sm text-muted-foreground"
                        >
                          {message}
                        </p>
                      )}
                      <Button type="submit" disabled={isPending}>
                        {isPending ? "Saving…" : "Save pricing"}
                      </Button>
                    </form>
                  )}
                </PlanPricingEditor>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
