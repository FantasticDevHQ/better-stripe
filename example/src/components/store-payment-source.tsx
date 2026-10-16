import { useBalanceFunding } from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
function BalancePaymentEmptyState() {
  return (
    <p className="text-sm text-muted-foreground">
      No balance payment authorization is active.
    </p>
  );
}

export function StorePaymentSource({ sellerId }: { sellerId: Id<"users"> }) {
  const state = useQuery(api.storeBalance.funding.public.queries.state, {
    sellerId,
  });
  const change = useAction(api.storeBalance.actions.setFunding);
  const {
    consent,
    setConsent,
    isPending: busy,
    error,
    confirm,
  } = useBalanceFunding({
    scopeKey: sellerId,
    change: (args) => change({ sellerId, ...args }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment source</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p role="status" className="font-medium">
            {state === undefined
              ? "Loading…"
              : state.enabled
                ? "Pay from Stripe balance"
                : "Pay with saved payment method"}
          </p>
          <p className="text-sm text-muted-foreground">
            Pay monthly platform charges from your available Stripe earnings
            before those funds are paid out. If your balance is insufficient,
            payment can fail; switch to your saved payment method to pay
            instead.
          </p>
          {state && !state.enabled && <BalancePaymentEmptyState />}
          {state &&
            (state.enabled ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void confirm(false)}
              >
                Use saved payment method
              </Button>
            ) : (
              <>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-1"
                  />
                  I authorize BetterStripe to debit this store's Stripe balance
                  for recurring platform charges.
                </label>
                <Button
                  disabled={!consent || busy}
                  onClick={() => void confirm(true)}
                >
                  {busy ? "Saving…" : "Confirm balance payments"}
                </Button>
              </>
            ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
