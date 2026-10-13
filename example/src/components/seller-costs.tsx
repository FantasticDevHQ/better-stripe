import { EmptyState } from "@/components/empty-state";
import { CostRecovery } from "@fantastic.dev/better-stripe/react";
import { WorkflowTable } from "@/components/workflow-table";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function SellerCosts({ kind }: { kind: "refund" | "dispute" }) {
  const { currentUser } = useRole();
  const costs = useQuery(
    api.sellerCostBilling.list,
    currentUser.id ? { sellerId: currentUser.id as Id<"users"> } : "skip",
  );
  const rows = costs?.filter(
    (cost) =>
      (cost.sourceType ?? (cost.disputeFees > 0 ? "dispute" : "refund")) ===
      kind,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kind === "refund" ? "Refund costs" : "Dispute costs"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Non-refundable Stripe costs are deducted from upcoming store
            earnings before payout. Any remainder goes on the next monthly bill.
            Returned costs become credits.
          </p>
          <CostRecovery
            rows={rows}
            emptyLabel={
              kind === "refund"
                ? "No refund costs yet."
                : "No dispute costs yet."
            }
          >
            {(state) =>
              state.isEmpty ? (
                <EmptyState>
                  {kind === "refund"
                    ? "No refund costs yet."
                    : "No dispute costs yet."}
                </EmptyState>
              ) : (
                <WorkflowTable {...state} />
              )
            }
          </CostRecovery>
        </div>
      </CardContent>
    </Card>
  );
}
