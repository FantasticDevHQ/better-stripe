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
import { Card } from "@/components/ui/card";
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

function HeadlessDisputes({ stripeAccountId }: { stripeAccountId: string }) {
  const { disputes, isLoading } = useDisputes({ accountId: stripeAccountId });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const { dispute } = useDisputeWithCountdown(selectedId);
  const submitEvidence = useAction(api.actions.submitDisputeEvidence);

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
              onClick={() => setSelectedId(row.dispute.stripeDisputeId)}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-muted"
              data-dispute-id={row.dispute.stripeDisputeId}
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
