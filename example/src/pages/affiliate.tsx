import {
  useReferralLinks,
  ReferredSales,
  Earnings,
} from "@fantastic.dev/better-stripe/react";
import { WorkflowTable } from "@/components/workflow-table";
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
          <Earnings {...earnings}>
            {({ metrics, isLoading }) => (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {metrics.map(({ label, formattedValue }) => (
                  <Card
                    key={label}
                    variant={label === "Net" ? "muted" : "default"}
                  >
                    <CardHeader>
                      <CardTitle variant="metric">{label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p
                        role="status"
                        aria-live="polite"
                        className="text-3xl font-semibold tracking-tight tabular-nums"
                      >
                        {isLoading ? "…" : formattedValue}
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
            )}
          </Earnings>
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
            <ReferredSales rows={sales}>
              {(state) => <WorkflowTable {...state} />}
            </ReferredSales>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function AffiliateLinks() {
  const stores = useQuery(api.storefront.listStores);
  const { copy } = useReferralLinks();
  const copyLink = async (url: string) => {
    if (await copy(url)) toast.success("Referral link copied");
    else toast.error("Could not copy the link. Select and copy the URL below.");
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
