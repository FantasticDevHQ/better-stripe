import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100,
  );
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
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Non-refundable Stripe costs are deducted from upcoming store earnings
          before payout. Any remainder goes on the next monthly bill. Returned
          costs become credits.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Payment",
                "Total cost",
                "Deducted from earnings",
                "Added to invoice",
                "Outstanding",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows?.map((cost) => (
              <TableRow key={cost._id}>
                <TableCell>
                  <code className="text-xs">{cost.paymentIntentId}</code>
                </TableCell>
                {[
                  cost.amountDue,
                  cost.collectedAmount,
                  cost.invoicedAmount,
                  cost.outstanding,
                ].map((amount, index) => (
                  <TableCell
                    key={
                      ["total", "deducted", "invoiced", "outstanding"][index]
                    }
                  >
                    {money(amount, cost.currency)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!rows?.length && (
              <TableRow>
                <TableCell colSpan={5}>
                  {rows === undefined
                    ? "Loading costs…"
                    : `No ${kind} costs yet.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
