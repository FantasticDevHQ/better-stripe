import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAction, useQuery } from "convex/react";
import {
  CheckCircle,
  FlaskConical,
  Play,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { adminTestingActions } from "./adminTestingActions";

interface LogEntry {
  timestamp: string;
  action: string;
  result: string;
  status: "success" | "error";
}

export function AdminTesting() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [firing, setFiring] = useState<string | null>(null);
  const stripeMode = useQuery(api.queries.getStripeMode);

  const fireAccountUpdated = useAction(adminTestingActions.fireAccountUpdated);
  const fireSubscriptionUpdated = useAction(
    adminTestingActions.fireSubscriptionUpdated,
  );
  const fireCheckoutCompleted = useAction(
    adminTestingActions.fireCheckoutCompleted,
  );
  const fireInvoicePaid = useAction(adminTestingActions.fireInvoicePaid);

  const addLog = (
    action: string,
    result: string,
    status: "success" | "error" = "success",
  ) => {
    setLog((prev) => [
      {
        timestamp: new Date().toLocaleTimeString(),
        action,
        result,
        status,
      },
      ...prev,
    ]);
  };

  const runTrigger = async (
    action: string,
    fn: () => Promise<Record<string, unknown>>,
  ) => {
    setFiring(action);
    try {
      const result = await fn();
      addLog(action, JSON.stringify(result, null, 2));
    } catch (err) {
      addLog(
        action,
        err instanceof Error ? err.message : "Unknown error",
        "error",
      );
    } finally {
      setFiring(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Testing Utilities</h1>
        <p className="text-muted-foreground mt-1">
          Demonstrates{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 text-sm">
            better-stripe/testing
          </code>{" "}
          exports for development and testing workflows.
          {stripeMode && (
            <Badge variant="outline" className="ml-2">
              {stripeMode} mode
            </Badge>
          )}
        </p>
      </div>

      {/* Environment Guard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Environment Guard
          </CardTitle>
          <CardDescription>
            <code className="bg-muted rounded px-1.5 py-0.5 text-sm">
              assertTestEnvironment()
            </code>{" "}
            throws if called in production. Use it to guard test-only code
            paths.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              addLog("assertTestEnvironment()", "Test environment confirmed");
            }}
          >
            <Play data-icon="inline-start" className="mr-2 h-4 w-4" />
            Assert Test Environment
          </Button>
        </CardContent>
      </Card>

      {/* Real Webhook Triggers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Real Webhook Triggers
            <Badge variant="destructive" className="ml-1">
              test-mode only
            </Badge>
          </CardTitle>
          <CardDescription>
            Fires <strong>real</strong> test-mode Stripe API calls against the
            seeded marketplace demo (run <code>npm run setup</code> first) — not
            simulated events. Each button polls the component ledger for a few
            seconds afterward and reports whether the row actually synced; that
            only happens if{" "}
            <code className="bg-muted rounded px-1.5 py-0.5 text-sm">
              stripe listen --forward-to &lt;site&gt;/stripe/webhook
            </code>{" "}
            is running locally (see README → &quot;Browser E2E Tests&quot;).
            Confirmed events also appear in the Webhook Event Log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={firing !== null}
              onClick={() =>
                runTrigger("fireCheckoutCompleted()", fireCheckoutCompleted)
              }
            >
              {firing === "fireCheckoutCompleted()"
                ? "Firing…"
                : "Checkout Completed"}
            </Button>
            <Button
              variant="outline"
              disabled={firing !== null}
              onClick={() =>
                runTrigger("fireSubscriptionUpdated()", fireSubscriptionUpdated)
              }
            >
              {firing === "fireSubscriptionUpdated()"
                ? "Firing…"
                : "Subscription Updated"}
            </Button>
            <Button
              variant="outline"
              disabled={firing !== null}
              onClick={() =>
                runTrigger("fireAccountUpdated()", fireAccountUpdated)
              }
            >
              {firing === "fireAccountUpdated()"
                ? "Firing…"
                : "Account Updated"}
            </Button>
            <Button
              variant="outline"
              disabled={firing !== null}
              onClick={() => runTrigger("fireInvoicePaid()", fireInvoicePaid)}
            >
              {firing === "fireInvoicePaid()" ? "Firing…" : "Invoice Paid"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Fixture Factories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Fixture Factories
          </CardTitle>
          <CardDescription>
            Create typed test data for unit and integration tests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                addLog(
                  "createTestAccount()",
                  JSON.stringify({
                    stripeAccountId: "acct_test_1",
                    userId: "test_user_1",
                    country: "US",
                    onboardingStatus: "complete",
                  }),
                );
              }}
            >
              Create Test Account
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                addLog(
                  "createTestProduct()",
                  JSON.stringify({
                    stripeProductId: "prod_test_1",
                    name: "Test Product",
                    active: true,
                  }),
                );
              }}
            >
              Create Test Product
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                addLog(
                  "createTestPrice()",
                  JSON.stringify({
                    stripePriceId: "price_test_1",
                    amount: 2900,
                    currency: "usd",
                    interval: "month",
                  }),
                );
              }}
            >
              Create Test Price
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                addLog(
                  "createTestSubscription()",
                  JSON.stringify({
                    stripeSubscriptionId: "sub_test_1",
                    userId: "test_user_1",
                    status: "active",
                    currentPeriodEnd: "2026-04-24",
                  }),
                );
              }}
            >
              Create Test Subscription
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity Log */}
      {log.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
            <CardDescription>
              No data yet. Run a testing utility to record its result here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {log.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Activity Log</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setLog([])}>
                <Trash2 data-icon="inline-start" className="mr-1 h-3 w-3" />
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {log.map((entry, i) => (
                <div key={i}>
                  <div className="flex gap-3 py-2 text-sm">
                    <span className="text-muted-foreground shrink-0 font-mono">
                      {entry.timestamp}
                    </span>
                    {entry.status === "success" ? (
                      <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    )}
                    <div className="min-w-0">
                      <span className="font-mono font-medium">
                        {entry.action}
                      </span>
                      <pre className="text-muted-foreground mt-0.5 overflow-x-auto text-xs">
                        {entry.result}
                      </pre>
                    </div>
                  </div>
                  {i < log.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
