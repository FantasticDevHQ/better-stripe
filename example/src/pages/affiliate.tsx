import {
  useReferralLinks,
  ReferredSales,
  Pagination,
  useCursorPagination,
  Earnings,
  EarningsSummary,
  type EarningsRenderProps,
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

function AffiliateEarningsCards({
  metrics,
  isLoading,
  payouts,
}: EarningsRenderProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, formattedValue }) => (
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
              {isLoading ? "…" : formattedValue}
            </p>
            {label === "Paid out" && !isLoading && payouts.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                No payouts yet
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function Affiliate({
  integration = "headless",
}: {
  integration?: "headless" | "components";
}) {
  const { currentUser } = useRole();
  const earnings = useEarnings(currentUser.stripeAccountId);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Referral earnings</h1>
        <p className="mt-2 text-muted-foreground">
          {currentUser.name} earns the seller's configured affiliate commission,
          calculated after the sale fee. Product and subscription price
          overrides take priority over the store plan default. The customer
          receives the purchase; the seller receives the remainder.
        </p>
      </div>
      {!currentUser.stripeAccountId ? (
        <MissingAccount />
      ) : (
        <>
          <Earnings {...earnings}>
            {(state) =>
              integration === "components" &&
              !state.isLoading &&
              (earnings.gross !== 0 || state.payouts.length > 0) ? (
                <EarningsSummary {...earnings}>
                  {({ grossLabel, reversedLabel, netLabel, paidOutLabel }) => {
                    const values = {
                      gross: grossLabel,
                      reversed: reversedLabel,
                      net: netLabel,
                      paidOut: paidOutLabel,
                    };
                    return (
                      <AffiliateEarningsCards
                        {...state}
                        metrics={state.metrics.map((metric) => ({
                          ...metric,
                          formattedValue: values[metric.key],
                        }))}
                      />
                    );
                  }}
                </EarningsSummary>
              ) : (
                <AffiliateEarningsCards {...state} />
              )
            }
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
  const pagination = useCursorPagination(
    currentUser.stripeAccountId ?? currentUser.id,
  );
  const sales = useQuery(
    api.queries.paginateAffiliateSales,
    currentUser.stripeAccountId
      ? {
          accountId: currentUser.stripeAccountId,
          paginationOpts: { numItems: 10, cursor: pagination.cursor },
        }
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
            <ReferredSales rows={sales?.page}>
              {(state) => <WorkflowTable {...state} />}
            </ReferredSales>
            <Pagination
              page={pagination.page}
              canPrevious={pagination.canPrevious}
              canNext={sales !== undefined && !sales.isDone}
              isLoading={sales === undefined}
              onPrevious={pagination.previous}
              onNext={() => {
                if (sales && !sales.isDone)
                  pagination.next(sales.continueCursor);
              }}
            >
              {({
                pageLabel,
                previousLabel,
                nextLabel,
                previousDisabled,
                nextDisabled,
                previous,
                next,
              }) => (
                <nav
                  aria-label="Referred sales pagination"
                  className="mt-4 flex items-center justify-between gap-3"
                >
                  <Button
                    variant="outline"
                    disabled={previousDisabled}
                    onClick={previous}
                  >
                    {previousLabel}
                  </Button>
                  <span
                    role="status"
                    aria-live="polite"
                    className="text-sm text-muted-foreground"
                  >
                    {pageLabel}
                  </span>
                  <Button
                    variant="outline"
                    disabled={nextDisabled}
                    onClick={next}
                  >
                    {nextLabel}
                  </Button>
                </nav>
              )}
            </Pagination>
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
