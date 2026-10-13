import { useState, useCallback, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/setup-controls";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

export function EnvVarsCard() {
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    refresh();
  }, [refresh]);

  const allSet =
    envs?.stripeSecretKey && envs?.webhookSecret && envs?.webhookSecretV2;

  return (
    <Card size="panel">
      <div className="space-y-4">
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
            <AlertDescription>
              <div className="space-y-2">
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
              </div>
            </AlertDescription>
          </Alert>
        )}

        {allSet && (
          <p className="text-muted-foreground text-sm">
            All environment variables are set.
          </p>
        )}
      </div>
    </Card>
  );
}
