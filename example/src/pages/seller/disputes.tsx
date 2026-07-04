/**
 * Seller disputes page (BTS-44) — the culminating dispute demo.
 *
 * Ties the whole dispute stack together from a single seller-facing page,
 * exercising the merged library surface two ways:
 *
 *  - **Headless** (default): `useDisputes` → `DisputesList` (status + due-by
 *    countdown), and on selecting a row, `useDisputeWithCountdown` →
 *    `DisputeDetail` + `EvidenceForm` (submit evidence via the app's
 *    `submitDisputeEvidence` action, which forwards to `stripe.updateDispute`).
 *  - **Embedded** (Stripe Connect): `ConnectProvider` + `EmbeddedDisputes`,
 *    fed by a Convex action calling `createDisputeSession({ stripeAccountId })`.
 *
 * Data is scoped to the signed-in seller persona's store account (BTS-41 seed).
 */
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDisputes, useDisputeWithCountdown } from "@/lib/dispute-hooks";
import { useRole } from "@/providers/role-context";
import {
  ConnectProvider,
  DisputeDetail,
  DisputesList,
  EmbeddedDisputes,
  EvidenceForm,
  type EvidenceFormUpdateArgs,
} from "@getdojo/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";

function formatMoney(amount: number, currency: string = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

type ChargebackTransfer = {
  stripeTransferId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  role?: string;
  reversedAmount?: number;
  reversalStatus?: string;
};

type ChargebackSummary = {
  dispute: { stripeChargeId?: string; currency: string; status: string };
  transfers: ChargebackTransfer[];
  gross: number;
  reversed: number;
  net: number;
};

function ChargebackLedger({
  chargeback,
}: {
  chargeback: ChargebackSummary | null | undefined;
}) {
  if (chargeback === undefined) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (chargeback === null || !chargeback.dispute.stripeChargeId) {
    return (
      <Alert data-testid="chargeback-ledger-empty">
        <AlertDescription>
          No linked charge is available yet, so there are no transfer clawbacks
          to display.
        </AlertDescription>
      </Alert>
    );
  }

  const currency = chargeback.dispute.currency;

  return (
    <div className="space-y-3" data-testid="chargeback-ledger">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">
            Original transfers
          </div>
          <div className="text-lg font-semibold" data-testid="chargeback-gross">
            {formatMoney(chargeback.gross, currency)}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Funds pulled back</div>
          <div
            className="text-lg font-semibold text-destructive"
            data-testid="chargeback-reversed"
          >
            -{formatMoney(chargeback.reversed, currency)}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Seller net</div>
          <div className="text-lg font-semibold" data-testid="chargeback-net">
            {formatMoney(chargeback.net, currency)}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {chargeback.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transfer rows found for charge{" "}
            {chargeback.dispute.stripeChargeId}.
          </p>
        ) : (
          chargeback.transfers.map((transfer) => (
            <div
              key={transfer.stripeTransferId}
              className="rounded-md border p-3 text-sm"
              data-testid="chargeback-transfer-row"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono">{transfer.stripeTransferId}</span>
                <Badge variant="secondary">
                  {transfer.reversalStatus ?? "not_reversed"}
                </Badge>
              </div>
              <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-3">
                <span>{transfer.role ?? "transfer"}</span>
                <span>{formatMoney(transfer.amount, transfer.currency)}</span>
                <span data-testid="chargeback-transfer-reversed">
                  clawback{" "}
                  {formatMoney(transfer.reversedAmount ?? 0, transfer.currency)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HeadlessDisputes({ stripeAccountId }: { stripeAccountId: string }) {
  const { disputes, isLoading } = useDisputes({ accountId: stripeAccountId });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [acceptStatus, setAcceptStatus] = useState<
    "idle" | "submitting" | "accepted" | "error"
  >("idle");
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const { dispute } = useDisputeWithCountdown(selectedId);
  const chargeback = useQuery(
    api.queries.getDisputeChargeback,
    selectedId ? { stripeDisputeId: selectedId } : "skip",
  ) as ChargebackSummary | null | undefined;
  const submitEvidence = useAction(api.actions.submitDisputeEvidence);
  const acceptDispute = useAction(api.actions.acceptDispute);

  async function handleAcceptDispute() {
    if (!selectedId) return;
    setAcceptStatus("submitting");
    setAcceptError(null);
    try {
      await acceptDispute({
        stripeDisputeId: selectedId,
        stripeAccountId,
      });
      setAcceptStatus("accepted");
    } catch (err) {
      setAcceptStatus("error");
      setAcceptError(
        err instanceof Error ? err.message : "Failed to accept dispute",
      );
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="p-4" data-testid="disputes-list">
        <h2 className="mb-3 text-lg font-semibold">Your disputes</h2>
        <DisputesList
          disputes={disputes}
          isLoading={isLoading}
          emptyLabel="No disputes — trigger a test dispute to see one here."
          renderRow={(row) => (
            <button
              key={row.dispute.stripeDisputeId}
              type="button"
              onClick={() => {
                setSelectedId(row.dispute.stripeDisputeId);
                setAcceptStatus("idle");
                setAcceptError(null);
              }}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-muted"
              data-dispute-id={row.dispute.stripeDisputeId}
              data-testid="dispute-row"
            >
              <span className="font-mono text-sm">
                {row.dispute.stripeDisputeId}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{row.dispute.status}</Badge>
                {row.badgeText && (
                  <Badge variant="destructive">{row.badgeText}</Badge>
                )}
              </span>
            </button>
          )}
        />
      </Card>

      <Card className="p-4" data-testid="dispute-detail">
        <h2 className="mb-3 text-lg font-semibold">Respond to dispute</h2>
        {!selectedId ? (
          <Alert>
            <AlertDescription>
              Select a dispute to view its deadline and submit evidence.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <DisputeDetail dispute={dispute} />
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Accept chargeback</h3>
                  <p className="text-sm text-muted-foreground">
                    Concede the dispute and keep the clawback in place.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleAcceptDispute}
                  disabled={acceptStatus === "submitting"}
                  data-testid="accept-dispute-button"
                >
                  {acceptStatus === "submitting"
                    ? "Accepting..."
                    : "Accept dispute"}
                </Button>
              </div>
              {acceptStatus === "accepted" && (
                <p className="mt-2 text-sm" data-testid="accept-dispute-status">
                  Dispute accepted. The row will update after Stripe delivers
                  the closed webhook.
                </p>
              )}
              {acceptError && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {acceptError}
                </p>
              )}
            </div>
            <EvidenceForm
              stripeDisputeId={selectedId}
              stripeAccountId={stripeAccountId}
              onUpdateDispute={(args: EvidenceFormUpdateArgs) =>
                submitEvidence({
                  stripeDisputeId: args.stripeDisputeId,
                  evidence: args.evidence,
                  submit: args.submit,
                  stripeAccountId: args.stripeAccountId,
                })
              }
            />
            <Separator />
            <section className="space-y-3">
              <div>
                <h3 className="font-medium">Chargeback clawback</h3>
                <p className="text-sm text-muted-foreground">
                  Transfer reversals recorded for the disputed charge.
                </p>
              </div>
              <ChargebackLedger chargeback={chargeback} />
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmbeddedSellerDisputes({
  stripeAccountId,
}: {
  stripeAccountId: string;
}) {
  const publishableKey = useQuery(api.queries.getPublishableKey);
  const createSession = useAction(api.actions.createDisputeSession);

  if (!publishableKey) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card className="p-4" data-testid="embedded-disputes">
      <h2 className="mb-3 text-lg font-semibold">
        Embedded disputes (Stripe Connect)
      </h2>
      <ConnectProvider
        publishableKey={publishableKey}
        fetchClientSecret={async () =>
          (await createSession({ stripeAccountId })).clientSecret
        }
      >
        <EmbeddedDisputes />
      </ConnectProvider>
    </Card>
  );
}

export function SellerDisputes() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (account === null || !account.stripeAccountId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Disputes</h1>
        <Alert>
          <AlertDescription>
            No Stripe Connect account found. Visit the{" "}
            <a href="/seller/onboarding" className="text-primary underline">
              onboarding page
            </a>{" "}
            to set up your store before managing disputes.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const stripeAccountId = account.stripeAccountId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Disputes</h1>
        <p className="text-muted-foreground">
          Review chargebacks and submit evidence. Winning a dispute reinstates
          the clawed-back transfer; losing (or a fraud dispute) auto-cancels the
          buyer's subscription.
        </p>
      </div>

      <Tabs defaultValue="headless">
        <TabsList>
          <TabsTrigger value="headless">Headless components</TabsTrigger>
          <TabsTrigger value="embedded">Embedded (Connect)</TabsTrigger>
        </TabsList>
        <TabsContent value="headless" className="pt-4">
          <HeadlessDisputes stripeAccountId={stripeAccountId} />
        </TabsContent>
        <TabsContent value="embedded" className="pt-4">
          <EmbeddedSellerDisputes stripeAccountId={stripeAccountId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
