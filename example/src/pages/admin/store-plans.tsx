import {
  AffiliatePayoutControl,
  GlobalAffiliateSettings,
} from "@/components/affiliate-payout-control";
import { EmptyState } from "@/components/empty-state";
import { PlanPricingEditor } from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { useRole } from "@/providers/role-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
export function AdminStorePlans() {
  const { currentUser } = useRole();
  const plans = useQuery(api.storePlanPricing.list, {});
  const update = useAction(api.storePlanPricing.update);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Store plans</h1>
        <p className="text-sm text-muted-foreground">
          Manage monthly store subscriptions, sale fees, and affiliate payouts.
        </p>
      </div>
      <GlobalAffiliateSettings actorId={currentUser.id} />
      <p className="text-sm text-muted-foreground">
        Monthly price changes apply to new subscriptions. Existing subscriptions
        keep their current price. Sellers always cover actual Stripe processing.
        Unset plan payouts inherit the global setting, otherwise 0%. Clear
        removes the override.
      </p>
      {plans === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : plans.length === 0 ? (
        <EmptyState>
          No store plans are configured yet. Open Setup to initialize the
          example.
        </EmptyState>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monthly price (USD)</TableHead>
                <TableHead>Sale fee (%)</TableHead>
                <TableHead>Affiliate payout</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <PlanPricingEditor
                  key={plan.id}
                  plan={plan}
                  onSave={(values) =>
                    update({
                      monthlyAmount: values.monthlyAmount,
                      feeBasisPoints: values.feeBasisPoints,
                      expectedVersion: values.expectedVersion,
                      planId: plan.id,
                      adminId: currentUser.id as Id<"users">,
                    })
                  }
                >
                  {({
                    monthlyPrice,
                    saleFee,
                    setMonthlyPrice,
                    setSaleFee,
                    save,
                    isPending,
                    error,
                    message,
                  }) => (
                    <TableRow>
                      <TableCell>
                        <p className="font-medium">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Monthly subscription
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge>Active</Badge>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-28"
                          aria-label={`${plan.name} monthly price (USD)`}
                          form={`pricing-${plan.id}`}
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
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-28"
                          aria-label={`${plan.name} sale fee (%)`}
                          form={`pricing-${plan.id}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          inputMode="decimal"
                          value={saleFee}
                          disabled={isPending}
                          placeholder="Stripe only"
                          onChange={(event) => setSaleFee(event.target.value)}
                        />
                        <p className="mt-1 max-w-48 whitespace-normal text-xs text-muted-foreground">
                          {plan.feeLabel}
                        </p>
                      </TableCell>
                      <TableCell data-testid={`plan-affiliate-${plan.id}`}>
                        <AffiliatePayoutControl
                          scopeKey={`plan:${plan.id}`}
                          version={plan.version}
                          affiliateBasisPoints={
                            plan.affiliateFixedAmount != null
                              ? null
                              : (plan.affiliateBasisPoints ?? null)
                          }
                          affiliateFixedAmount={plan.affiliateFixedAmount}
                          effectiveBasisPoints={plan.effectiveBasisPoints}
                          effectiveFixedAmount={plan.effectiveFixedAmount}
                          currency="usd"
                          onSave={(values) =>
                            update({
                              ...values,
                              monthlyAmount: plan.monthlyAmount,
                              feeBasisPoints: plan.feeBasisPoints,
                              planId: plan.id,
                              adminId: currentUser.id as Id<"users">,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <form
                          id={`pricing-${plan.id}`}
                          aria-label={`${plan.name} pricing`}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void save();
                          }}
                        >
                          <Button
                            type="submit"
                            variant="outline"
                            disabled={isPending}
                          >
                            {isPending ? "Saving…" : "Save pricing"}
                          </Button>
                          {error && (
                            <p
                              role="alert"
                              className="max-w-48 whitespace-normal text-xs text-destructive"
                            >
                              {error}
                            </p>
                          )}
                          {message && (
                            <p
                              role="status"
                              className="text-xs text-muted-foreground"
                            >
                              {message}
                            </p>
                          )}
                        </form>
                      </TableCell>
                    </TableRow>
                  )}
                </PlanPricingEditor>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
