import { Invoices as BetterStripeInvoices } from "@fantastic.dev/better-stripe/react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { WorkflowTable } from "@/components/workflow-table";
import { useRole } from "@/providers/role-context";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
export function Invoices() {
  const { currentUser } = useRole();
  const invoices = useQuery(api.queries.listInvoicesByUser, {
    userId: currentUser.id,
  });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-muted-foreground mt-1">
          View and download your past invoices.
        </p>
      </div>
      <Card>
        <BetterStripeInvoices
          rows={invoices}
          emptyLabel="No data found. Invoices will appear after billing begins."
        >
          {(state) => (
            <WorkflowTable
              {...state}
              renderCell={(invoice, column, content) =>
                column.id === "status" ? (
                  <Badge
                    variant={
                      invoice.status === "paid"
                        ? "default"
                        : ["failed", "uncollectible"].includes(invoice.status)
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {content}
                  </Badge>
                ) : (
                  content
                )
              }
            />
          )}
        </BetterStripeInvoices>
      </Card>
    </div>
  );
}
