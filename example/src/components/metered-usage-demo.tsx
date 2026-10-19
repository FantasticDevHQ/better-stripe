import { useSearchParams } from "react-router-dom";
import { MeteredProducts } from "./metered-products";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  UsageBilling,
  UsageHistory,
  UsagePriceRow,
  type UsageBillingSnapshot,
  type UsageHistoryPage,
  type UsageViewScope,
} from "@fantastic.dev/better-stripe/react";
import type {
  UsageAvailability,
  UsageBillingModel,
  UsageEventView,
} from "@fantastic.dev/better-stripe/usage";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useRole } from "@/providers/role-context";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { demoConfiguration } from "../../convex/meteredUsage/policy";
import type { DemoProviderState } from "../../convex/meteredUsage/types";
import { MeteredConfiguration } from "./metered-configuration";
import { MeteredBillingOutcome } from "./metered-billing-outcome";
import { useMeteredDemo } from "./use-metered-demo";
import "./metered-usage.css";
const models = [
  {
    key: "pay_as_you_go",
    label: "Pay as you go",
    detail: "Recorded units become monthly metered invoice charges.",
  },
  {
    key: "included_overage",
    label: "Included monthly usage",
    detail: "Ten included units per original billing period, then overages.",
  },
  {
    key: "prepaid",
    label: "Prepaid credits",
    detail: "Verified paid credits fund work. Exhaustion stops consumption.",
  },
] as const;
export function MeteredProtocolDemo() {
  const { currentUser, currentRole } = useRole();
  if (!currentUser.id || !["customer", "seller", "admin"].includes(currentRole))
    return (
      <EmptyState>
        Choose a customer, seller or admin persona to run native metered
        billing.
      </EmptyState>
    );
  return (
    <MeteredModels
      key={currentUser.id}
      actorId={currentUser.id as Id<"users">}
      role={currentRole}
    />
  );
}
function MeteredModels({
  actorId,
  role,
}: {
  actorId: Id<"users">;
  role: string;
}) {
  const [model, setModel] = useState<UsageBillingModel>("pay_as_you_go");
  return (
    <div data-usage-demo="" className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Metered billing
        </h1>
        <p className="text-muted-foreground">
          Three native Stripe models, one reusable component and ledger.
        </p>
      </div>
      <Alert>
        <AlertDescription>
          Stripe sandbox only. Demo personas are not production authentication.
          The server verifies fixture ownership and test mode. No production or
          live-money setup.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2" aria-label="Billing models">
        {models.map((item) => (
          <Button
            key={item.key}
            variant={model === item.key ? "default" : "outline"}
            aria-pressed={model === item.key}
            onClick={() => setModel(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <ModelWorkflow key={model} actorId={actorId} role={role} model={model} />
    </div>
  );
}
function ModelWorkflow({
  actorId,
  role,
  model,
}: {
  actorId: Id<"users">;
  role: string;
  model: UsageBillingModel;
}) {
  const meta = useQuery(api.meteredUsage.readers.current, { actorId, model });
  const run = meta ? (JSON.parse(meta) as Doc<"meteredDemoRuns">) : null;
  const cleanup = run?.cleanupJson
    ? (JSON.parse(run.cleanupJson) as { status: string })
    : null;
  const provider = run?.providerJson
    ? (JSON.parse(run.providerJson) as DemoProviderState)
    : null;
  const admin = role === "admin" || role === "seller";
  const task = useMeteredDemo(actorId, model, run, admin);
  const load = useAction(api.meteredUsage.readers.snapshot);
  const history = useAction(api.meteredUsage.readers.history);
  const choice = models.find((item) => item.key === model)!;
  const source = run
    ? (JSON.parse(run.configurationJson) as ReturnType<
        typeof demoConfiguration
      >)
    : demoConfiguration(model);
  const initial =
    provider && !run?.archived
      ? {
          ...source,
          plan: provider.meter.binding.plan,
          eventName: provider.meter.binding.eventName,
          meterId: provider.meter.scope.meterId,
        }
      : source;
  const scope: UsageViewScope | null = provider
    ? {
        identityKey: `${actorId}:${task.revision}`,
        accountKey: run!._id,
        meterKey: `${provider.meter.scope.meterId}:${provider.meter.binding.plan.version}`,
        currency: provider.price.currency,
        period: provider.meter.subscription.period,
      }
    : null;
  if (meta === undefined) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{choice.label}</CardTitle>
          <CardDescription>
            {choice.detail} Default demos use USD 1 per call and five-unit work
            batches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {role === "seller" && model !== "prepaid"
                ? "Seller product, billed by the sandbox issuer. Original seller and affiliate routing is pinned on the server."
                : "Owner: sandbox issuer's own services."}{" "}
              Accounts v2 payer mapping is verified on the server.
              Connected-account billing headers and a third-party credit wallet
              are unsupported.
            </p>
            <MeteredConfiguration
              scope={{
                identityKey: actorId,
                accountKey: run?._id ?? "new",
                productKey: model,
                role: role === "seller" ? "seller" : "admin",
                ownershipLabel: "Sandbox issuer",
                canConfigure: admin && (!run || run.archived),
                capability: "issuer_native",
              }}
              initial={initial}
              meters={
                provider && !run?.archived
                  ? [
                      {
                        id: provider.meter.scope.meterId,
                        active: !run?.archived,
                        configuration: initial,
                      },
                    ]
                  : []
              }
              onSave={async (value) => {
                if (!(await task.run("configure", value)))
                  throw new Error("Configuration was not saved.");
              }}
            />
            {(!provider || run?.archived) && (
              <Button
                disabled={task.isPending}
                onClick={() => void task.run("setup")}
              >
                {run?.archived
                  ? "Start new sandbox run"
                  : run
                    ? "Resume original setup"
                    : "Set up sandbox"}
              </Button>
            )}
            {provider && (
              <>
                <UsagePriceRow
                  value={{
                    kind: "metered",
                    price: {
                      ...provider.price,
                      active: !run?.archived && provider.price.active,
                    },
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Original terms stay attached to subscriptions and credits.
                  Configuration changes require a safely archived run and a new
                  version.
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      {provider && run && (
        <Card>
          <CardHeader>
            <CardTitle>Synthetic activity</CardTitle>
            <CardDescription>
              Reserve capacity before work. Replay retains the original identity
              and timestamp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    task.isPending ||
                    run.archived ||
                    run.billingStartedAt !== undefined
                  }
                  onClick={() => void task.run("consume")}
                >
                  {task.retryingWork
                    ? "Retry original five-unit work"
                    : "Run five units"}
                </Button>
                <Button
                  variant="outline"
                  disabled={task.isPending || !run.lastActivityId}
                  onClick={() => void task.run("replay")}
                >
                  Replay last work
                </Button>
                <Button
                  variant="outline"
                  disabled={task.isPending || !run.lastAcceptedActivityId}
                  onClick={() => void task.run("correct")}
                >
                  Correct last accepted event
                </Button>
                <Button
                  variant="outline"
                  disabled={task.isPending || run.archived}
                  onClick={() => void task.run("deliver")}
                >
                  Resume queued deliveries
                </Button>
                <Button
                  variant="outline"
                  disabled={task.isPending}
                  onClick={() => void task.run("observe")}
                >
                  Observe native usage
                </Button>
              </div>
              {model === "prepaid" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={
                      task.isPending ||
                      run.archived ||
                      run.billingStartedAt !== undefined
                    }
                    onClick={() => void task.run("purchase")}
                  >
                    Create credit purchase
                  </Button>
                  <Button
                    variant="outline"
                    disabled={task.isPending || !run.lastPurchaseId}
                    onClick={() => void task.run("confirm")}
                  >
                    Confirm sandbox card
                  </Button>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Usage acceptance and credit consumption collect no second
                payment. Native aggregates can lag. A finalized invoice and
                verified original cash source are separate evidence.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {task.error && (
        <Alert variant="destructive">
          <AlertDescription>{task.error}</AlertDescription>
        </Alert>
      )}
      {task.result && (
        <p role="status" className="text-sm">
          {task.result}
        </p>
      )}
      {scope && run && (
        <>
          <UsageBilling
            scope={scope}
            unit={provider!.meter.binding.plan.unit.name}
            load={async () =>
              JSON.parse(
                await load({ actorId, runId: run._id }),
              ) as UsageBillingSnapshot
            }
          />
          <UsageHistory<UsageEventView>
            scope={scope}
            historyKey="original-events"
            label="Original usage history"
            load={async (_scope, page) =>
              JSON.parse(
                await history({ actorId, runId: run._id, ...page }),
              ) as UsageAvailability<UsageHistoryPage<UsageEventView>>
            }
            getKey={(row) => row.receipt.eventId}
            renderRecord={(row) => (
              <div className="space-y-1">
                <p>
                  {row.record.quantity} {row.record.binding.plan.unit.name} ·{" "}
                  {row.delivery}
                </p>
                <p className="text-xs text-muted-foreground">
                  Original source {row.record.sourceEventId}
                </p>
              </div>
            )}
          />
          <MeteredBillingOutcome
            json={run.billingJson}
            prepaid={model === "prepaid"}
          />
          <Card>
            <CardHeader>
              <CardTitle>Close period and clean up</CardTitle>
              <CardDescription>
                Closing fences new work, waits for exact native aggregation and
                advances only this run's test clock. Cleanup stops owned
                recurring resources and preserves all financial history.
                Unresolved operations remain held.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={task.isPending || run.archived}
                    onClick={() => void task.run("bill")}
                  >
                    Close or resume original billing period
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      task.isPending || run.archived || !run.billingJson
                    }
                    onClick={() => void task.run("archive")}
                  >
                    Archive or resume scoped cleanup
                  </Button>
                </div>
                {run.cleanupJson && (
                  <p role="status">
                    Cleanup: {cleanup?.status}. Original evidence is retained.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function MeteredUsageDemo() {
  const { currentRole } = useRole();
  const [params] = useSearchParams();
  return currentRole === "admin" && params.get("diagnostics") === "protocol" ? (
    <MeteredProtocolDemo />
  ) : (
    <MeteredProducts />
  );
}
