import { useAction } from "convex/react";
import {
  UsageBilling,
  UsageHistory,
  useUsageBilling,
  useUsageHistory,
  type UsageBillingProps,
  type UsageHistoryProps,
  type UsageHistoryPage,
} from "@fantastic.dev/better-stripe/react";
import type {
  UsageAvailability,
  UsageBillingSnapshot,
  UsageEventView,
  UsageSubscriptionView,
} from "@fantastic.dev/better-stripe/usage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { IntegrationExamples } from "./integration-examples";
export function ProductUsageViews({
  actorId,
  enrollment,
  subscription,
  revision,
}: {
  actorId: Id<"users">;
  enrollment: Doc<"meteredProductEnrollments">;
  subscription: UsageSubscriptionView;
  revision: number;
}) {
  const load = useAction(api.meteredProducts.readers.snapshot);
  const history = useAction(api.meteredProducts.readers.history);
  const meter = subscription.bindings[0];
  const ref = { actorId, enrollmentId: enrollment._id };
  const billing: UsageBillingProps = {
    scope: {
      identityKey: `${actorId}:${revision}`,
      accountKey: enrollment._id,
      meterKey: `${meter.scope.meterId}:${meter.binding.plan.version}`,
      currency: subscription.currency,
      period: meter.subscription.period,
    },
    unit: meter.binding.plan.unit.name,
    load: async () => JSON.parse(await load(ref)) as UsageBillingSnapshot,
  };
  const records: UsageHistoryProps<UsageEventView> = {
    scope: billing.scope,
    historyKey: "product-sessions",
    load: async (_scope, page) =>
      JSON.parse(await history({ ...ref, ...page })) as UsageAvailability<
        UsageHistoryPage<UsageEventView>
      >,
    getKey: (row) => row.receipt.eventId,
    renderRecord: (row) => (
      <p>
        {row.record.quantity} {row.record.binding.plan.unit.name} ·{" "}
        {row.delivery}
      </p>
    ),
  };
  return (
    <IntegrationExamples
      headless={<HeadlessUsage billing={billing} history={records} />}
      components={
        <div className="space-y-5">
          <UsageBilling {...billing} />
          <UsageHistory {...records} />
        </div>
      }
      note="Via API uses public headless hooks with custom rendering. BetterStripe components render the reusable billing and history workflows."
    />
  );
}
function HeadlessUsage({
  billing,
  history,
}: {
  billing: UsageBillingProps;
  history: UsageHistoryProps<UsageEventView>;
}) {
  const state = useUsageBilling(billing);
  const page = useUsageHistory(history);
  const allowance = state.data?.allowance;
  const credits = state.data?.credits;
  const summary = state.data?.summary;
  return (
    <section aria-label="Product usage via API" className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={state.isLoading || page.isLoading}
          onClick={() => {
            state.refresh();
            page.refresh();
          }}
        >
          Refresh usage
        </Button>
      </div>
      {state.isLoading && <p role="status">Loading usage…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {summary?.status === "available" ? (
        <p>
          {summary.value.eventCount} accepted sessions ·{" "}
          {summary.value.complete
            ? "complete local summary"
            : "partial local summary"}
        </p>
      ) : (
        <p>Usage is not yet available.</p>
      )}
      {allowance?.status === "available" && allowance.value && (
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-sm text-muted-foreground">Minutes used</dt>
            <dd className="text-xl font-medium">
              {allowance.value.consumedQuantity}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Included minutes remaining
            </dt>
            <dd className="text-xl font-medium">
              {allowance.value.remainingIncludedQuantity}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Overage minutes</dt>
            <dd className="text-xl font-medium">
              {allowance.value.billableOverageQuantity}
            </dd>
          </div>
        </dl>
      )}
      {credits?.status === "available" && (
        <p>
          Credit backing: {credits.value.status}. Available quantity:{" "}
          {credits.value.availableQuantity}.
        </p>
      )}
      {state.data?.provider?.status === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          An exact native meter summary is unavailable for this billing period.
          Preview the next invoice for Stripe's current estimate.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Native aggregation may lag. Accepted usage is an estimate until Stripe
        finalizes the invoice.
      </p>
      <div className="space-y-2">
        <h3 className="font-medium">Session history</h3>
        {page.error && <p role="alert">{page.error}</p>}
        {page.data?.status === "available" &&
          page.data.value.records.map((row) => (
            <div key={history.getKey(row)}>{history.renderRecord(row)}</div>
          ))}
        {page.isEmpty && <p>No completed sessions yet.</p>}
        {page.isIncomplete && (
          <p>History is incomplete. Refresh before making billing decisions.</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!page.canPrevious || page.isLoading}
            onClick={page.previous}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!page.canNext || page.isLoading}
            onClick={page.next}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
