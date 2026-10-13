import { EnvVarsCard } from "@/components/setup-env-vars";
import { CopyButton } from "@/components/setup-controls";
import {
  useWorkflowAction,
  useWebhookSetup,
  useTaskRunner,
  FixtureProgress,
} from "@fantastic.dev/better-stripe/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAction, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 1: Environment Variables
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 2: Webhook Destinations
// ---------------------------------------------------------------------------

function EnvCommandRow({
  command,
  envName,
  verifyFn,
}: {
  command: string;
  envName: "v1" | "v2";
  verifyFn: () => Promise<{ v1: boolean; v2: boolean }>;
}) {
  const verification = useWorkflowAction(verifyFn, envName);
  const verified = !!verification.result?.[envName];
  const checkingEnv = verification.isPending;
  const failed =
    !!verification.error || (verification.result !== undefined && !verified);
  const handleVerify = () => verification.run();

  const envVarName =
    envName === "v1" ? "STRIPE_WEBHOOK_SECRET" : "STRIPE_WEBHOOK_SECRET_V2";

  if (verified) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-md p-3 text-sm">
        <span className="text-muted-foreground">
          <code>{envVarName}</code> is set in Convex.
        </span>
        <Badge variant="default" className="ml-auto">
          Verified
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-muted flex items-center gap-2 rounded-md p-3 font-mono text-xs">
        <code className="flex-1 select-all overflow-x-auto">{command}</code>
        <CopyButton text={command} label="Copy" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerify}
          disabled={checkingEnv}
        >
          {checkingEnv ? "Checking…" : "Verify"}
        </Button>
      </div>
      {failed && (
        <p className="text-muted-foreground text-sm">
          <code>{envVarName}</code> is not set yet. Copy the command above and
          run it in your terminal, then click Verify again.
        </p>
      )}
    </div>
  );
}

function WebhookSetupCard() {
  const setupWebhooks = useAction(api.actions.setupWebhooks);
  const getWebhookStatus = useAction(api.actions.getWebhookStatus);
  const verifyWebhookEnvs = useAction(api.actions.verifyWebhookEnvs);

  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
  const {
    result,
    error,
    status,
    isChecking,
    isPending: isLoading,
    configure: handleSetup,
  } = useWebhookSetup({
    scopeKey: `webhooks:${siteUrl ?? "missing"}`,
    load: () =>
      siteUrl ? getWebhookStatus({ siteUrl }) : Promise.resolve(null),
    setup: () => {
      if (!siteUrl) throw new Error("Configure VITE_CONVEX_SITE_URL first.");
      return setupWebhooks({ siteUrl });
    },
  });

  const v1EnvCommand = result?.v1.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET ${result.v1.secret}`
    : null;
  const v2EnvCommand = result?.v2.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET_V2 ${result.v2.secret}`
    : null;

  return (
    <Card size="panel">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">2. Webhook Destinations</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Creates two Stripe event destinations:{" "}
              <strong>V1 snapshot</strong> for payments/subscriptions and{" "}
              <strong>V2 thin</strong> for Connect account onboarding events.
            </p>
          </div>
          <Button
            onClick={handleSetup}
            disabled={isLoading || !siteUrl}
            className="shrink-0"
          >
            {isLoading ? "Setting up…" : "Setup Webhooks"}
          </Button>
        </div>

        {!isChecking && status && (
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="status"
            aria-live="polite"
          >
            <div className="border-border rounded-md border p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">V1 Snapshot</span>
                {status.v1 ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="destructive">Not found</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {status.v1
                  ? `${status.v1.eventCount} events — payments, subscriptions, invoices, payouts`
                  : 'Click "Setup Webhooks" to create'}
              </p>
            </div>
            <div className="border-border rounded-md border p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">V2 Thin</span>
                {status.v2 ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="destructive">Not found</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {status.v2
                  ? `${status.v2.eventCount} events — Connect account onboarding & status`
                  : 'Click "Setup Webhooks" to create'}
              </p>
            </div>
          </div>
        )}
        {isChecking && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-18 w-full" />
            <Skeleton className="h-18 w-full" />
          </div>
        )}

        {!siteUrl && (
          <Alert variant="destructive">
            <AlertDescription>
              Missing <code>VITE_CONVEX_SITE_URL</code> in your{" "}
              <code>.env.local</code>.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert role="status" aria-live="polite">
            <AlertDescription>
              <div className="space-y-3">
                <p>
                  Webhook destinations configured. Set these Convex environment
                  variables:
                </p>
                {v1EnvCommand && (
                  <EnvCommandRow
                    command={v1EnvCommand}
                    envName="v1"
                    verifyFn={verifyWebhookEnvs}
                  />
                )}
                {v2EnvCommand && (
                  <EnvCommandRow
                    command={v2EnvCommand}
                    envName="v2"
                    verifyFn={verifyWebhookEnvs}
                  />
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Seed Demo Data
// ---------------------------------------------------------------------------

function SeedDataCard() {
  const seedDemoData = useAction(api.actions.seedDemoData);
  const seedStatus = useQuery(api.queries.getSeedStatus);
  const fixtures = useQuery(api.sandboxFixtureState.status);
  const populateSandbox = useAction(api.sandboxFixtures.start);
  const products = useQuery(api.queries.listProducts);

  const tasks = useTaskRunner({ scopeKey: "seed" });
  const isSeeding = tasks.isPending;
  const done = !!tasks.results.seed;
  const error = tasks.errors.seed || tasks.errors.fixtures;
  const userCount = seedStatus?.userCount ?? 0;
  const productCount = products?.length ?? 0;
  const hasData = userCount > 0 || productCount > 0;
  const handleSeed = () => tasks.run("seed", () => seedDemoData({}));

  return (
    <Card size="panel">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">3. Seed Demo Data</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Creates demo users, linked Stripe accounts, products, and paid
              store plans. Then populates the Stripe sandbox with sales,
              affiliate referrals, refunds, disputes, subscriptions, invoices,
              and payouts. Reruns skip completed fixtures.
            </p>
          </div>
          <Button
            onClick={handleSeed}
            disabled={isSeeding}
            className="shrink-0"
          >
            {isSeeding ? "Seeding…" : "Seed Data"}
          </Button>
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Sandbox activity fixtures</h3>
              <p className="text-muted-foreground text-sm">
                40 sales, affiliate splits, 6 refunds, 4 disputes, and payouts.
                All transactions use Stripe test payment methods.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={
                isSeeding ||
                fixtures?.status === "running" ||
                fixtures?.status === "complete" ||
                userCount === 0
              }
              onClick={() => {
                void tasks.run("fixtures", () => populateSandbox({}));
              }}
            >
              {fixtures?.status === "failed"
                ? "Resume fixtures"
                : fixtures?.status === "complete"
                  ? "Fixtures populated"
                  : "Populate sandbox"}
            </Button>
          </div>
          {fixtures && (
            <FixtureProgress state={fixtures}>
              {({ progress, message, error, cursor, total }) => (
                <>
                  <progress
                    aria-label="Sandbox fixture progress"
                    className="h-2 w-full"
                    value={progress}
                    max={1}
                  />
                  <p className="text-muted-foreground text-sm" role="status">
                    {cursor} of {total} steps complete. {message}
                  </p>
                  {error && (
                    <p role="alert" className="text-destructive text-sm">
                      {error}
                    </p>
                  )}
                </>
              )}
            </FixtureProgress>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-border rounded-md border p-3">
            <p className="text-muted-foreground text-xs">Users</p>
            <p className="text-xl font-semibold">{userCount}</p>
          </div>
          <div className="border-border rounded-md border p-3">
            <p className="text-muted-foreground text-xs">Products</p>
            <p className="text-xl font-semibold">{productCount}</p>
          </div>
        </div>

        {!isSeeding &&
          !done &&
          seedStatus !== undefined &&
          products !== undefined &&
          !hasData && (
            <Alert role="status" aria-live="polite">
              <AlertDescription>
                No data found. Seed demo data to create users and products.
              </AlertDescription>
            </Alert>
          )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {done && !error && (
          <Alert role="status" aria-live="polite">
            <AlertDescription>Demo data seeded successfully.</AlertDescription>
          </Alert>
        )}

        {hasData && !done && (
          <p
            className="text-muted-foreground text-sm"
            role="status"
            aria-live="polite"
          >
            Data already exists. Clicking Seed Data will skip existing records.
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Sync from Stripe
// ---------------------------------------------------------------------------

function SyncCard() {
  const syncProducts = useAction(api.actions.syncProducts);
  const syncSubscriptions = useAction(api.actions.syncSubscriptions);
  const syncAccounts = useAction(api.actions.syncAccounts);

  const {
    pendingOperation: syncing,
    results,
    errors,
    run,
  } = useTaskRunner({ scopeKey: "sync", formatResult: () => "Synced" });
  const handleSync = (
    name: string,
    fn: (args: Record<string, never>) => Promise<unknown>,
  ) => run(name, () => fn({}));

  const items = [
    { name: "Products", action: syncProducts },
    { name: "Subscriptions", action: syncSubscriptions },
    { name: "Accounts", action: syncAccounts },
  ];

  return (
    <Card size="panel">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">4. Sync from Stripe</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Pull existing data from Stripe into Convex. Useful if you have
            products, subscriptions, or connected accounts already set up in
            Stripe.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {items.map(({ name, action }) => (
            <div key={name} className="border-border rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{name}</span>
                {results[name] && (
                  <Badge variant="default">{results[name]}</Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={syncing === name}
                onClick={() => handleSync(name, action)}
              >
                {syncing === name ? "Syncing…" : `Sync ${name}`}
              </Button>
              {errors[name] && (
                <p className="text-destructive mt-2 text-xs">{errors[name]}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Reset
// ---------------------------------------------------------------------------

function ResetCard() {
  const resetAll = useAction(api.actions.resetAll);
  const reset = useWorkflowAction(async () => {
    await resetAll({});
    return true;
  }, "reset");
  const isResetting = reset.isPending;
  const done = reset.result ?? false;
  const error = reset.error;
  const handleReset = () => reset.run();

  return (
    <Card size="panel">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">5. Reset</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Clear all data from the app database (users) and the better-stripe
              component database (accounts, products, prices, subscriptions,
              invoices, payments, payouts, webhook events). Use this when you
              reset your Stripe sandbox.
            </p>
          </div>
          <Button
            variant="destructive-solid"
            className="shrink-0"
            onClick={handleReset}
            disabled={isResetting}
          >
            {isResetting ? "Resetting…" : "Reset All Data"}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {done && (
          <Alert>
            <AlertDescription>
              All data cleared. Click "Seed Data" above to re-populate.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AdminSetup() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-muted-foreground mt-1">
          Configure your better-stripe example app. Each step is independent —
          run them in any order.
        </p>
      </div>
      <EnvVarsCard />
      <WebhookSetupCard />
      <SeedDataCard />
      <SyncCard />
      <ResetCard />
    </div>
  );
}
