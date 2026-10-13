import { useState } from "react";
import { useAction } from "convex/react";
import { Link } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export function StoreInvoiceEstimate({ sellerId }: { sellerId: Id<"users"> }) {
  const estimate = useAction(api.storeInvoiceActions.estimate);
  const [invoice, setInvoice] =
    useState<FunctionReturnType<typeof api.storeInvoiceActions.estimate>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const money = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: invoice?.currency ?? "usd",
    }).format(amount / 100);
  async function refresh() {
    setBusy(true);
    setError(undefined);
    try {
      setInvoice(await estimate({ sellerId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated next invoice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your upcoming Stripe subscription invoice plus outstanding cost
          adjustments. Costs recovered from earnings before renewal will reduce
          this estimate.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? "Loading…" : invoice ? "Refresh estimate" : "View estimate"}
        </Button>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {invoice && (
          <>
            <p className="text-sm text-muted-foreground">
              Next billing date:{" "}
              {new Date(invoice.nextBillingAt).toLocaleDateString()}
            </p>
            <ul className="divide-y">
              {invoice.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex justify-between gap-4 py-3 text-sm"
                >
                  <span className="min-w-0 break-all">
                    {line.sourceType ? (
                      <Link
                        className="underline"
                        to={
                          line.sourceType === "refund"
                            ? "/seller/refunds"
                            : "/seller/disputes"
                        }
                      >
                        {line.description}
                      </Link>
                    ) : (
                      line.description
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {money(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t pt-4 font-semibold">
              <span>Estimated total</span>
              <span className="tabular-nums">{money(invoice.total)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
