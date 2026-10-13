import { EmptyState } from "@/components/empty-state";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { useRole } from "@/providers/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const formatters = new Map<string, Intl.NumberFormat>();
function formatCurrency(cents: number, currency: string) {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}
export function SellerSales() {
  const { currentUser } = useRole();
  const sales = useQuery(
    api.storeSaleSettlement.listSellerSales,
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
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Plan",
                  "Sale",
                  "Stripe processing",
                  "Platform",
                  "Affiliate",
                  "Cost recovery",
                  "Your earnings",
                  "Status",
                  "Payment",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sales ?? []).map((sale) => (
                <TableRow key={sale._id}>
                  <TableCell>{sale.planId}</TableCell>
                  {(
                    [
                      "gross",
                      "processingFee",
                      "platformNet",
                      "affiliateNet",
                      "costRecoveryAmount",
                      "sellerNet",
                    ] as const
                  ).map((field) => (
                    <TableCell key={field}>
                      {formatCurrency(sale[field] ?? 0, sale.currency)}
                    </TableCell>
                  ))}
                  <TableCell>{sale.status}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <code className="block select-all text-xs">
                        {sale.paymentIntentId}
                      </code>
                      <Link
                        className="text-primary text-sm underline"
                        to={`/seller/refunds?${new URLSearchParams({ payment_intent: sale.paymentIntentId, charge_id: sale.chargeId })}`}
                      >
                        Refund or reverse
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {sales === undefined && (
                <TableRow>
                  <TableCell colSpan={9}>Loading sales…</TableCell>
                </TableRow>
              )}
              {sales?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState>No sales under a store plan yet.</EmptyState>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
