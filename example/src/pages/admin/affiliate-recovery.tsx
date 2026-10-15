import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Pagination,
  useCursorPagination,
  AffiliateRecovery,
  AffiliateRecoveryHistory,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function AdminAffiliateRecovery() {
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [selected, setSelected] = useState("");
  const validCurrency = /^[a-z]{3}$/.test(currency);
  const snapshots = useCursorPagination(
    `affiliate-recovery:${account}:${currency}`,
  );
  const attempts = useCursorPagination(`affiliate-attempts:${selected}`);
  const snapshot = useQuery(
    api.affiliateRecovery.snapshot,
    account && validCurrency
      ? {
          affiliateAccountId: account,
          currency,
          paginationOpts: { cursor: snapshots.cursor, numItems: 20 },
        }
      : "skip",
  );
  const history = useQuery(
    api.affiliateRecovery.history,
    selected
      ? {
          obligationId: selected,
          paginationOpts: { cursor: attempts.cursor, numItems: 50 },
        }
      : "skip",
  );
  const retry = useAction(api.affiliateRecovery.retry);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Affiliate commission recovery</h1>
      <p className="text-muted-foreground">
        Live balances and receipts require an authenticated operator. The demo
        persona selector does not grant access.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="recovery-account">Affiliate account</Label>
          <Input
            id="recovery-account"
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
              setSelected("");
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recovery-currency">Currency</Label>
          <Input
            id="recovery-currency"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value.toLowerCase());
              setSelected("");
            }}
          />
        </div>
      </div>
      {snapshot && snapshot.obligations.page.length === 0 && (
        <EmptyState>No commission adjustments in this currency.</EmptyState>
      )}
      {account && validCurrency && (
        <Card>
          <CardHeader>
            <CardTitle>Recovery and debt</CardTitle>
          </CardHeader>
          <CardContent>
            <AffiliateRecovery
              currency={currency}
              snapshot={snapshot}
              onInspect={setSelected}
              onRetry={async (obligationId) => {
                setSelected(obligationId);
                return retry({ obligationId });
              }}
              sourceHref={(row) =>
                row.paymentIntentId
                  ? `https://dashboard.stripe.com/payments/${encodeURIComponent(row.paymentIntentId)}`
                  : undefined
              }
            />
            {snapshot && (
              <Pagination
                page={snapshots.page}
                canPrevious={snapshots.canPrevious}
                canNext={!snapshot.obligations.isDone}
                onPrevious={snapshots.previous}
                onNext={() =>
                  snapshots.next(snapshot.obligations.continueCursor)
                }
              />
            )}
          </CardContent>
        </Card>
      )}
      {history && history.page.length === 0 && (
        <EmptyState>
          No recovery attempts. Provider receipts will appear here.
        </EmptyState>
      )}
      {history && history.page.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Confirmed receipts and failed attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <AffiliateRecoveryHistory
              operations={history.page}
              currency={currency}
            />
            <Pagination
              page={attempts.page}
              canPrevious={attempts.canPrevious}
              canNext={!history.isDone}
              onPrevious={attempts.previous}
              onNext={() => attempts.next(history.continueCursor)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
