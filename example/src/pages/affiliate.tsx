import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { useRole } from "@/providers/role-context";
import { useEarnings } from "@/lib/stripe-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AFFILIATE_REFERRAL_CODE } from "../../convex/affiliateSplit";

const money = (amount: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100,
  );

function AffiliateEmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function MissingAccount() {
  return (
    <Alert>
      <AlertDescription>
        Your affiliate Stripe account has not been set up. Open Admin → Setup to
        finish seeding.
      </AlertDescription>
    </Alert>
  );
}

export function Affiliate() {
  const { currentUser } = useRole();
  const earnings = useEarnings(currentUser.stripeAccountId);
  const figures = [
    { label: "Gross", amount: earnings.gross },
    { label: "Reversals & adjustments", amount: earnings.reversed },
    { label: "Net", amount: earnings.net },
    { label: "Paid out", amount: earnings.paidOut },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Referral earnings</h1>
        <p className="mt-2 text-muted-foreground">
          {currentUser.name} earns 20% of referred sales after the sale fee. The
          customer receives the purchase; the seller receives the remaining 80%.
        </p>
      </div>
      {!currentUser.stripeAccountId ? (
        <MissingAccount />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {figures.map(({ label, amount }) => (
              <Card key={label} variant={label === "Net" ? "muted" : "default"}>
                <CardHeader>
                  <CardTitle variant="metric">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-3xl font-semibold tracking-tight tabular-nums"
                  >
                    {earnings.isLoading ? "…" : money(amount)}
                  </p>
                  {label === "Paid out" &&
                    !earnings.isLoading &&
                    earnings.payouts.length === 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No payouts yet
                      </p>
                    )}
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="break-all text-sm text-muted-foreground">
            Stripe account: {currentUser.stripeAccountId}
          </p>
        </>
      )}
    </div>
  );
}

export function AffiliateSales() {
  const { currentUser } = useRole();
  const sales = useQuery(
    api.queries.listAffiliateSales,
    currentUser.stripeAccountId
      ? { accountId: currentUser.stripeAccountId }
      : "skip",
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Referred sales</h1>
        <p className="mt-2 text-muted-foreground">
          Your commission from purchases made through your referral links.
        </p>
      </div>
      {!currentUser.stripeAccountId ? (
        <MissingAccount />
      ) : (
        <Card>
          <CardContent padding="section">
            {sales === undefined ? (
              <p role="status">Loading referred sales…</p>
            ) : sales.length ? (
              <ul className="divide-y">
                {sales.map((transfer) => (
                  <li
                    key={transfer.stripeTransferId}
                    className="flex justify-between gap-4 py-4 text-sm first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {transfer.storeName ?? "Store unavailable"}
                      </p>
                      <p className="mt-1 break-all text-muted-foreground">
                        {transfer.sourceChargeId ?? transfer.stripeTransferId}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {money(transfer.amount, transfer.currency ?? "usd")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <AffiliateEmptyState>No referred sales yet.</AffiliateEmptyState>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function AffiliateLinks() {
  const stores = useQuery(api.storefront.listStores);
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Referral link copied");
    } catch {
      toast.error("Could not copy the link. Select and copy the URL below.");
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Referral links</h1>
        <p className="mt-2 text-muted-foreground">
          Share these links with customers or visitors. Preview a link, then
          choose Customer or Visitor to test a purchase.
        </p>
      </div>
      <Card>
        <CardContent padding="section">
          <div className="space-y-6">
            {stores === undefined ? (
              <p role="status">Loading referral links…</p>
            ) : stores.filter((store) => store.products.length).length === 0 ? (
              <AffiliateEmptyState>
                No stores available yet.
              </AffiliateEmptyState>
            ) : (
              stores
                .filter((store) => store.products.length)
                .map((store) => {
                  const path = `/stores?${new URLSearchParams({ store: store.accountId, ref: AFFILIATE_REFERRAL_CODE })}`;
                  const url = `${window.location.origin}${path}`;
                  return (
                    <div key={store.accountId}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Link className="font-medium underline" to={path}>
                          {store.name}
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Copy referral link for ${store.name}`}
                          onClick={() => void copyLink(url)}
                        >
                          <Copy aria-hidden="true" data-icon="inline-start" />
                          Copy link
                        </Button>
                      </div>
                      <p className="mt-1 break-all text-sm text-muted-foreground select-all">
                        {url}
                      </p>
                    </div>
                  );
                })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
