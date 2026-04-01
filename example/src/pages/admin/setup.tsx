import { useCallback, useEffect, useState } from "react";

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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? "Copied!" : (label ?? "Copy")}
    </Button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"}>
      {label ?? (ok ? "Set" : "Not set")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Environment Variables
// ---------------------------------------------------------------------------

function EnvVarsCard() {
  const checkEnvVars = useAction(api.actions.checkEnvVars);
  const [envs, setEnvs] = useState<{
    stripeSecretKey: boolean;
    webhookSecret: boolean;
    webhookSecretV2: boolean;
  } | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const result = await checkEnvVars({});
      setEnvs(result);
    } catch {
      // non-fatal
    } finally {
      setChecking(false);
    }
  }, [checkEnvVars]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const allSet =
    envs?.stripeSecretKey && envs?.webhookSecret && envs?.webhookSecretV2;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">1. Environment Variables</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Convex environment variables must be set for the app to connect to
            Stripe. Set <code>STRIPE_SECRET_KEY</code> first — the webhook
            secrets are set after running webhook setup (step 2).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={checking}
        >
          {checking ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {checking && !envs ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : envs ? (
        <div className="space-y-2">
          {[
            { name: "STRIPE_SECRET_KEY", set: envs.stripeSecretKey },
            { name: "STRIPE_WEBHOOK_SECRET", set: envs.webhookSecret },
            { name: "STRIPE_WEBHOOK_SECRET_V2", set: envs.webhookSecretV2 },
          ].map(({ name, set }) => (
            <div
              key={name}
              className="bg-muted flex items-center justify-between rounded-md px-3 py-2"
            >
              <code className="text-sm">{name}</code>
              <StatusBadge ok={set} />
            </div>
          ))}
        </div>
      ) : null}

      {envs && !envs.stripeSecretKey && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>
              Set your Stripe secret key first. Find it in the{" "}
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Stripe Dashboard
              </a>
              , then run:
            </p>
            <div className="bg-muted flex items-center gap-2 rounded-md p-3 font-mono text-xs">
              <code className="flex-1">
                npx convex env set STRIPE_SECRET_KEY sk_test_your_key_here
              </code>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {allSet && (
        <p className="text-muted-foreground text-sm">
          All environment variables are set.
        </p>
      )}
    </Card>
  );
}

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
  const [verified, setVerified] = useState(false);
  const [checkingEnv, setCheckingEnv] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleVerify = async () => {
    setCheckingEnv(true);
    setFailed(false);
    try {
      const result = await verifyFn();
      if (result[envName]) {
        setVerified(true);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setCheckingEnv(false);
    }
  };

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

  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<{
    v1: { id: string; secret: string; url: string };
    v2: {
      id: string;
      secret: string;
      url: string;
      enabledEvents: string[];
      created: boolean;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    v1: { id: string; status: string; eventCount: number } | null;
    v2: { id: string; status: string; eventCount: number } | null;
  } | null>(null);

  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

  const checkStatus = useCallback(async () => {
    if (!siteUrl) return;
    setIsChecking(true);
    try {
      const s = await getWebhookStatus({ siteUrl });
      setStatus(s);
    } catch {
      // Non-fatal
    } finally {
      setIsChecking(false);
    }
  }, [siteUrl, getWebhookStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleSetup = async () => {
    if (!siteUrl) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await setupWebhooks({ siteUrl });
      setResult(res);
      await checkStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const v1EnvCommand = result?.v1.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET ${result.v1.secret}`
    : null;
  const v2EnvCommand = result?.v2.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET_V2 ${result.v2.secret}`
    : null;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">2. Webhook Destinations</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates two Stripe event destinations: <strong>V1 snapshot</strong>{" "}
            for payments/subscriptions and <strong>V2 thin</strong> for Connect
            account onboarding events.
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
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
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
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          <AlertDescription className="space-y-3">
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
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Seed Demo Data
// ---------------------------------------------------------------------------

function SeedDataCard() {
  const seedDemoData = useAction(api.actions.seedDemoData);
  const seedStatus = useQuery(api.queries.getSeedStatus);
  const products = useQuery(api.queries.listProducts);

  const [isSeeding, setIsSeeding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userCount = seedStatus?.userCount ?? 0;
  const productCount = products?.length ?? 0;
  const hasData = userCount > 0 || productCount > 0;

  const handleSeed = async () => {
    setIsSeeding(true);
    setError(null);
    try {
      await seedDemoData({});
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">3. Seed Demo Data</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates demo users (customer, seller, admin) and Stripe products
            with prices. Idempotent — skips if data already exists.
          </p>
        </div>
        <Button onClick={handleSeed} disabled={isSeeding} className="shrink-0">
          {isSeeding ? "Seeding…" : "Seed Data"}
        </Button>
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {done && !error && (
        <Alert>
          <AlertDescription>Demo data seeded successfully.</AlertDescription>
        </Alert>
      )}

      {hasData && !done && (
        <p className="text-muted-foreground text-sm">
          Data already exists. Clicking Seed Data will skip existing records.
        </p>
      )}
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

  const [syncing, setSyncing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSync = async (
    name: string,
    fn: (args: Record<string, never>) => Promise<unknown>,
  ) => {
    setSyncing(name);
    setErrors((prev) => ({ ...prev, [name]: "" }));
    try {
      await fn({});
      setResults((prev) => ({ ...prev, [name]: "Synced" }));
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [name]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setSyncing(null);
    }
  };

  const items = [
    { name: "Products", action: syncProducts },
    { name: "Subscriptions", action: syncSubscriptions },
    { name: "Accounts", action: syncAccounts },
  ];

  return (
    <Card className="space-y-4 p-6">
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Reset
// ---------------------------------------------------------------------------

function ResetCard() {
  const resetAll = useAction(api.actions.resetAll);
  const [isResetting, setIsResetting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);
    setDone(false);
    try {
      await resetAll({});
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Card className="space-y-4 p-6">
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
          variant="outline"
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shrink-0"
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
