import {
  ChargebackLedger as BetterStripeChargebackLedger,
  type ChargebackSummary,
} from "@fantastic.dev/better-stripe/react";
import { Collection } from "@fantastic.dev/better-stripe/react";
import { WorkflowTable } from "@/components/workflow-table";
import { IntegrationExamples } from "@/components/integration-examples";
import { ConnectExample } from "@/components/connect-example";
import { SellerCosts } from "@/components/seller-costs";
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
 *    fed by a Convex action calling
 *    `createDisputeSession({ userId, stripeAccountId })`.
 *
 * Data is scoped to the signed-in seller persona's store account (BTS-41 seed).
 * Every action call below also passes `userId` so the server can bind the
 * claimed persona to the target dispute/account before touching Stripe
 * (BTS-83 — see example/README.md → "Demo security model").
 */
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisputes, useDisputeWithCountdown } from "@/lib/dispute-hooks";
import { useRole } from "@/providers/role-context";
import {
  useDisputeResponse,
  DisputeDetail,
  canRespondToDispute,
  DisputesList,
  EvidenceForm,
  type EvidenceFormUpdateArgs,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";

function ChargebackLedger({
  chargeback,
}: {
  chargeback: ChargebackSummary | null | undefined;
}) {
  return (
    <BetterStripeChargebackLedger chargeback={chargeback}>
      {(state) =>
        state.isLoading ? (
          <div role="status" aria-label="Loading chargeback ledger">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : state.isEmpty ? (
          <Alert data-testid="chargeback-ledger-empty">
            <AlertDescription>
              No linked charge is available yet, so there are no transfer
              clawbacks to display.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3" data-testid="chargeback-ledger">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Original transfers",
                  value: state.grossLabel,
                  id: "gross",
                },
                {
                  label: "Funds pulled back",
                  value: state.reversedLabel,
                  id: "reversed",
                },
                { label: "Seller net", value: state.netLabel, id: "net" },
              ].map((metric) => (
                <div key={metric.id} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {metric.label}
                  </div>
                  <div
                    className="text-lg font-semibold"
                    data-testid={`chargeback-${metric.id}`}
                  >
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
            <Collection
              rows={state.data!.transfers}
              columns={state.columns}
              getKey={(row) => row.stripeTransferId}
              emptyLabel="No transfer rows found."
            >
              {(rows) => <WorkflowTable {...rows} />}
            </Collection>
          </div>
        )
      }
    </BetterStripeChargebackLedger>
  );
}

function HeadlessDisputes({
  stripeAccountId,
  userId,
}: {
  stripeAccountId: string;
  userId: string;
}) {
  const { disputes, isLoading } = useDisputes({ accountId: stripeAccountId });
  const acceptDispute = useAction(api.actions.acceptDispute);
  const {
    selectedId,
    setSelectedId,
    acceptStatus,
    acceptError,
    requestAccept,
    cancelAccept,
    accept: handleAcceptDispute,
  } = useDisputeResponse({
    scopeKey: stripeAccountId,
    acceptDispute: (stripeDisputeId) =>
      acceptDispute({ userId, stripeDisputeId }),
  });
  const { dispute, isLoading: detailLoading } =
    useDisputeWithCountdown(selectedId);
  const chargeback = useQuery(
    api.queries.getDisputeChargeback,
    selectedId ? { stripeDisputeId: selectedId } : "skip",
  ) as ChargebackSummary | null | undefined;
  const submitEvidence = useAction(api.actions.submitDisputeEvidence);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card size="inset" data-testid="disputes-list">
        <h2 className="mb-3 text-lg font-semibold">Your disputes</h2>
        <DisputesList
          disputes={disputes}
          isLoading={isLoading}
          emptyLabel="No data yet — trigger a test dispute to see one here."
          renderRow={(row) => (
            <button
              key={row.dispute.stripeDisputeId}
              type="button"
              onClick={() => {
                setSelectedId(row.dispute.stripeDisputeId);
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

      <Card size="inset" data-testid="dispute-detail">
        <h2 className="mb-3 text-lg font-semibold">Respond to dispute</h2>
        {!selectedId ? (
          <Alert>
            <AlertDescription>
              Select a dispute to view its deadline and submit evidence.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <DisputeDetail dispute={dispute} isLoading={detailLoading} />
            {canRespondToDispute(dispute?.status) && (
              <>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium">Accept chargeback</h3>
                      <p className="text-sm text-muted-foreground">
                        Concede the dispute and keep the clawback in place.
                      </p>
                    </div>
                    {acceptStatus !== "confirming" && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={requestAccept}
                        disabled={acceptStatus === "submitting"}
                        data-testid="accept-dispute-button"
                      >
                        {acceptStatus === "submitting"
                          ? "Accepting..."
                          : "Accept dispute"}
                      </Button>
                    )}
                  </div>
                  {acceptStatus === "confirming" && (
                    <div
                      className="mt-3 space-y-2 rounded-md border border-destructive bg-destructive/10 p-3"
                      data-testid="accept-dispute-confirm-panel"
                    >
                      <p className="text-sm font-medium">
                        This cannot be undone. Accepting permanently closes the
                        dispute and keeps the clawback in place.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleAcceptDispute}
                          data-testid="accept-dispute-confirm-button"
                        >
                          Yes, accept dispute
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={cancelAccept}
                          data-testid="accept-dispute-cancel-button"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  {acceptStatus === "accepted" && (
                    <p
                      className="mt-2 text-sm"
                      data-testid="accept-dispute-status"
                    >
                      Dispute accepted. The row will update after Stripe
                      delivers the closed webhook.
                    </p>
                  )}
                  {acceptError && (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      {acceptError}
                    </p>
                  )}
                </div>
                <EvidenceForm
                  key={selectedId}
                  stripeDisputeId={selectedId}
                  onStaged={() => toast.success("Evidence draft saved")}
                  onSubmitted={() => toast.success("Evidence submitted")}
                  onUpdateDispute={(args: EvidenceFormUpdateArgs) =>
                    submitEvidence({
                      userId,
                      stripeDisputeId: args.stripeDisputeId,
                      evidence: args.evidence,
                      submit: args.submit,
                    })
                  }
                />
              </>
            )}
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

      <SellerCosts kind="dispute" />

      <IntegrationExamples
        headless={
          <HeadlessDisputes
            stripeAccountId={stripeAccountId}
            userId={currentUser.id}
          />
        }
        embedded={<ConnectExample kind="disputes" />}
      />
    </div>
  );
}
