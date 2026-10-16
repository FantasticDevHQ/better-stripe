import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Sales } from "@fantastic.dev/better-stripe/react";
import { useRole } from "@/providers/role-context";
import { WorkflowTable } from "@/components/workflow-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
export function SellerSales() {
  const { currentUser } = useRole();
  const sales = useQuery(
    api.settlement.public.queries.listSellerSales,
    currentUser.id ? { sellerId: currentUser.id as Id<"users"> } : "skip",
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sales</h1>
      <Card>
        <CardHeader>
          <CardTitle>Sales & fees</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-sm">
            Actual Stripe processing is included in the sale fee. The platform
            keeps the difference. Payouts wait until Stripe reports the actual
            processing cost.
          </p>
          <Sales
            rows={sales}
            emptyLabel="No data yet. Sales will appear after your first store-plan purchase."
          >
            {(state) => (
              <WorkflowTable
                {...state}
                renderCell={(sale, column, content) =>
                  column.id === "payment" ? (
                    <div className="space-y-1">
                      <code className="block select-all text-xs">
                        {content}
                      </code>
                      <Link
                        className="text-primary text-sm underline"
                        to={`/seller/refunds?${new URLSearchParams({ payment_intent: sale.paymentIntentId, charge_id: sale.chargeId ?? "" })}`}
                      >
                        Refund or reverse
                      </Link>
                    </div>
                  ) : (
                    content
                  )
                }
              />
            )}
          </Sales>
        </CardContent>
      </Card>
    </div>
  );
}
