import { useState } from "react";
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
  const state = useQuery(api.storeBalanceFunding.state, { sellerId });
  const change = useAction(api.storeBalanceActions.setFunding);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function confirm(enabled: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await change({
        sellerId,
        enabled,
        consent: enabled && consent ? true : undefined,
      });
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
          payment can fail; switch to your saved payment method to pay instead.
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
      </CardContent>
    </Card>
  );
}
