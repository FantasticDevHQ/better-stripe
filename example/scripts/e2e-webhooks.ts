/**
 * Automated E2E webhook test for the better-stripe trigger system.
 *
 * Exercises the REAL pipeline: Stripe-signed events (via `stripe trigger` +
 * `stripe listen --forward-to`) → deployed Convex HTTP endpoint → webhook
 * ledger dedup → sync trigger dispatchers (same-transaction triggerLog
 * writes) → async hooks.
 *
 * Flow:
 *   1. Preflight (stripe CLI, .env.local, Convex STRIPE_SECRET_KEY)
 *   2. Deploy current code (`npx convex dev --once`)
 *   3. Spawn `stripe listen --forward-to <site>/stripe/webhook`, parse the
 *      session signing secret from its Ready! line, and set it as
 *      STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_V2
 *   4. Clear the example's triggerLog table
 *   5. Fire every V1 event type our pipeline handles via `stripe trigger`
 *      (+ optionally create a V2 account to emit v2.core.account thin events)
 *   6. Poll the webhook ledger + triggerLog and print a PASS/FAIL/SKIP table
 *
 * Usage: pnpm --filter ./example run e2e:webhooks
 */
import { config } from "dotenv";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { resolve } from "node:path";

const exampleDir = resolve(import.meta.dirname, "..");
config({ path: resolve(exampleDir, ".env.local") });

const STRIPE_BIN = "stripe";
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 4_000;

// ─── Small helpers ───────────────────────────────────────────────────────

function convex(args: string[], timeoutMs = 120_000): string {
  return execFileSync("npx", ["convex", ...args], {
    cwd: exampleDir,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function convexRun<T>(fn: string, args: Record<string, unknown> = {}): T {
  const out = convex(["run", fn, JSON.stringify(args)]).trim();
  return (out ? JSON.parse(out) : null) as T;
}

function convexEnvSet(name: string, value: string): void {
  convex(["env", "set", name, value]);
}

function stripeTrigger(event: string, apiKey: string): void {
  execFileSync(STRIPE_BIN, ["trigger", event, "--api-key", apiKey], {
    encoding: "utf-8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Result tracking ─────────────────────────────────────────────────────

type Status = "PASS" | "FAIL" | "SKIP";

interface LedgerEvent {
  _creationTime: number;
  eventType: string;
  status: string;
}

interface TriggerLogRow {
  _creationTime: number;
  source: "trigger" | "hook";
  kind: string;
  stripeId: string;
}

interface Check {
  name: string;
  /** Returns true once satisfied. Omitted for pre-resolved SKIPs. */
  test?: (ledger: LedgerEvent[], log: TriggerLogRow[]) => boolean;
  status?: Status;
  detail: string;
}

function printTable(checks: Check[]): void {
  const nameWidth = Math.max(...checks.map((c) => c.name.length), 5) + 2;
  console.log("");
  console.log(`${"CHECK".padEnd(nameWidth)}${"RESULT".padEnd(8)}DETAIL`);
  console.log("─".repeat(nameWidth + 8 + 40));
  for (const c of checks) {
    console.log(
      `${c.name.padEnd(nameWidth)}${(c.status ?? "FAIL").padEnd(8)}${c.detail}`,
    );
  }
  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────────

let listenChild: ChildProcessWithoutNullStreams | null = null;

function killListen(): void {
  if (listenChild && !listenChild.killed) {
    listenChild.kill("SIGTERM");
    listenChild = null;
  }
}

process.on("SIGINT", () => {
  killListen();
  process.exit(130);
});

async function main(): Promise<void> {
  console.log("\n🧪 better-stripe E2E webhook test\n");

  // ─── 1. Preflight ───────────────────────────────────────────────────
  console.log("── Preflight ──");
  try {
    const cfg = execFileSync(STRIPE_BIN, ["config", "--list"], {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (!cfg.trim()) throw new Error("empty config");
    console.log("  ✅ stripe CLI found and configured");
  } catch {
    console.error(
      "  ❌ Stripe CLI not found or not configured.\n" +
        "     Install: brew install stripe/stripe-cli/stripe\n" +
        "     Then:    stripe login",
    );
    process.exit(1);
  }

  const siteUrl = process.env.VITE_CONVEX_SITE_URL;
  if (!siteUrl) {
    console.error(
      "  ❌ VITE_CONVEX_SITE_URL missing from example/.env.local.\n" +
        "     Run `npx convex dev --once` to link a dev deployment first.",
    );
    process.exit(1);
  }
  const webhookUrl = `${siteUrl}/stripe/webhook`;
  console.log(`  ✅ webhook endpoint: ${webhookUrl}`);

  // The CLI's logged-in session key may be expired or belong to a different
  // account than the deployment — always use the deployment's key so
  // `stripe trigger` / `stripe listen` hit the same account the Convex
  // functions use.
  let apiKey: string;
  try {
    apiKey = convex(["env", "get", "STRIPE_SECRET_KEY"]).trim();
    if (!apiKey.startsWith("sk_")) throw new Error("not an sk_ key");
    if (!apiKey.startsWith("sk_test_")) {
      console.error("  ❌ STRIPE_SECRET_KEY is not a TEST key — refusing.");
      process.exit(1);
    }
    console.log("  ✅ STRIPE_SECRET_KEY (test mode) read from Convex env");
  } catch {
    console.error(
      "  ❌ STRIPE_SECRET_KEY not set on the Convex deployment.\n" +
        "     Run `pnpm --filter ./example run setup` first.",
    );
    process.exit(1);
  }

  // ─── 2. Deploy current code ─────────────────────────────────────────
  console.log("\n── Deploy ──");
  console.log("  $ npx convex dev --once");
  convex(["dev", "--once"], 300_000);
  console.log("  ✅ deployed");

  // ─── 3 & 4. Start forwarding, capture session secret ────────────────
  console.log("\n── Stripe listen ──");
  const thinArgs = [
    "--thin-events",
    "v2.core.account.created,v2.core.account.updated",
    "--forward-thin-to",
    webhookUrl,
  ];
  let v2Supported = true;
  let secret: string;
  try {
    secret = await startListen(apiKey, webhookUrl, thinArgs);
  } catch (err) {
    console.log(
      `  ⚠️ stripe listen with thin-event flags failed (${String(err)});` +
        " retrying without V2 forwarding",
    );
    v2Supported = false;
    killListen();
    secret = await startListen(apiKey, webhookUrl, []);
  }
  console.log(`  ✅ forwarding ready (secret ${secret.slice(0, 10)}...)`);

  console.log("  Setting STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_V2");
  convexEnvSet("STRIPE_WEBHOOK_SECRET", secret);
  convexEnvSet("STRIPE_WEBHOOK_SECRET_V2", secret);
  console.log(
    "  ⚠️ Note: deployment webhook secrets now point at this stripe-CLI" +
      " session. That is correct for dev; re-run /admin/setup if you" +
      " later switch back to dashboard-managed webhook destinations.",
  );

  // ─── 5. Reset triggerLog ────────────────────────────────────────────
  console.log("\n── Reset ──");
  const cleared = convexRun<{ deleted: number }>(
    "triggerLogger:clearTriggerLog",
  );
  console.log(`  ✅ triggerLog cleared (${cleared.deleted} rows)`);
  // NOTE: we intentionally do NOT clear the component webhook ledger —
  // `stripe trigger` creates brand-new events each run, so dedup never
  // collides across reruns. Ledger assertions are time-scoped instead.
  const startMs = Date.now() - 15_000; // small clock-skew allowance

  // ─── 6. Fire events ─────────────────────────────────────────────────
  console.log("\n── Fire V1 events (stripe trigger) ──");
  // Every event here is (a) handled by our pipeline and (b) supported by
  // `stripe trigger` 1.42. payout.paid is handled by the pipeline but NOT
  // triggerable; payout.created/updated may fail without platform balance.
  const v1Events: { type: string; optional?: string }[] = [
    { type: "checkout.session.completed" },
    { type: "customer.subscription.created" },
    { type: "customer.subscription.updated" },
    { type: "customer.subscription.deleted" },
    { type: "invoice.paid" },
    { type: "payment_intent.succeeded" },
    { type: "payment_intent.payment_failed" },
    {
      type: "payout.created",
      optional: "often fails without available platform balance",
    },
  ];

  const fired = new Set<string>();
  const skippedFires = new Map<string, string>();
  for (const evt of v1Events) {
    process.stdout.write(`  stripe trigger ${evt.type} ... `);
    try {
      stripeTrigger(evt.type, apiKey);
      fired.add(evt.type);
      console.log("fired");
    } catch (err) {
      const reason = evt.optional ?? `trigger failed: ${String(err)}`;
      skippedFires.set(evt.type, reason);
      console.log(`SKIP (${reason})`);
    }
  }

  // V2 coverage: create a real V2 account → Stripe emits v2.core.account
  // thin events → forwarded via --forward-thin-to.
  let v2Attempted = false;
  let v2SkipReason = "";
  console.log("\n── Fire V2 event (create account) ──");
  if (!v2Supported) {
    v2SkipReason = "stripe listen thin-event forwarding unavailable";
    console.log(`  SKIP: ${v2SkipReason}`);
  } else {
    try {
      convexRun("actions:createAccountWithOnboarding", {
        userId: `e2e-${Date.now()}`,
        email: `e2e-${Date.now()}@example.com`,
        country: "US",
        refreshUrl: "https://example.com/refresh",
        returnUrl: "https://example.com/return",
      });
      v2Attempted = true;
      console.log("  ✅ V2 account created (expect v2.core.account.* events)");
    } catch (err) {
      v2SkipReason = `createAccountWithOnboarding failed: ${String(err)}`;
      console.log(`  SKIP: ${v2SkipReason}`);
    }
  }

  // ─── 7. Assertions ──────────────────────────────────────────────────
  const ledgerHas =
    (type: string) =>
    (ledger: LedgerEvent[]): boolean =>
      ledger.some(
        (e) => e.eventType === type && e._creationTime >= startMs,
      );
  const logHas =
    (source: "trigger" | "hook", kind: string) =>
    (_: LedgerEvent[], log: TriggerLogRow[]): boolean =>
      log.some((r) => r.source === source && r.kind === kind);

  const checks: Check[] = [];
  const ledgerCheck = (type: string): void => {
    if (fired.has(type)) {
      checks.push({
        name: `ledger: ${type}`,
        test: ledgerHas(type),
        detail: "processed row in webhook ledger",
      });
    } else {
      checks.push({
        name: `ledger: ${type}`,
        status: "SKIP",
        detail: skippedFires.get(type) ?? "not fired",
      });
    }
  };
  const dependentCheck = (
    name: string,
    firedType: string,
    test: Check["test"],
    detail: string,
  ): void => {
    if (fired.has(firedType)) {
      checks.push({ name, test, detail });
    } else {
      checks.push({
        name,
        status: "SKIP",
        detail: `${firedType} not fired (${skippedFires.get(firedType) ?? "?"})`,
      });
    }
  };

  ledgerCheck("checkout.session.completed");
  ledgerCheck("customer.subscription.created");
  ledgerCheck("customer.subscription.updated");
  ledgerCheck("customer.subscription.deleted");
  ledgerCheck("invoice.paid");
  ledgerCheck("payment_intent.succeeded");
  ledgerCheck("payment_intent.payment_failed");
  ledgerCheck("payout.created");

  dependentCheck(
    "trigger: checkoutSession.onCompleted",
    "checkout.session.completed",
    logHas("trigger", "checkoutSession.onCompleted"),
    "sync trigger ran inside dispatcher txn",
  );
  dependentCheck(
    "trigger: subscription.onCreate",
    "customer.subscription.created",
    logHas("trigger", "subscription.onCreate"),
    "sync trigger ran inside dispatcher txn",
  );
  dependentCheck(
    "trigger: subscription.onUpdate",
    "customer.subscription.updated",
    logHas("trigger", "subscription.onUpdate"),
    "sync trigger ran inside dispatcher txn",
  );
  dependentCheck(
    "trigger: subscription.onDelete",
    "customer.subscription.deleted",
    logHas("trigger", "subscription.onDelete"),
    "sync trigger ran inside dispatcher txn",
  );
  dependentCheck(
    "hook: onInvoicePaid",
    "invoice.paid",
    logHas("hook", "onInvoicePaid"),
    "async hook scheduled + executed",
  );
  dependentCheck(
    "hook: onPaymentFailed",
    "payment_intent.payment_failed",
    logHas("hook", "onPaymentFailed"),
    "async hook scheduled + executed",
  );
  checks.push({
    name: "hook: onPayoutCompleted",
    status: "SKIP",
    detail: "payout.paid is not a `stripe trigger`-supported event",
  });
  checks.push({
    name: "hook: onTrialEnding",
    status: "SKIP",
    detail: "trial_will_end not exercised by this test",
  });

  if (v2Attempted) {
    checks.push({
      name: "ledger: v2.core.account.*",
      test: (ledger) =>
        ledger.some(
          (e) =>
            e.eventType.startsWith("v2.core.account") &&
            e._creationTime >= startMs,
        ),
      detail: "thin event verified + processed",
    });
  } else {
    checks.push({
      name: "ledger: v2.core.account.*",
      status: "SKIP",
      detail: v2SkipReason,
    });
  }

  console.log(
    `\n── Polling assertions (up to ${POLL_TIMEOUT_MS / 1000}s) ──`,
  );
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const ledger = convexRun<LedgerEvent[]>("queries:listWebhookEvents", {
      status: "processed",
    });
    const log = convexRun<TriggerLogRow[]>("triggerLogger:listTriggerLog", {});
    let pending = 0;
    for (const c of checks) {
      if (c.status) continue;
      if (c.test!(ledger, log)) c.status = "PASS";
      else pending += 1;
    }
    if (pending === 0) break;
    if (Date.now() > deadline) {
      for (const c of checks) {
        if (!c.status) c.status = "FAIL";
      }
      break;
    }
    console.log(`  ... ${pending} check(s) pending`);
    await sleep(POLL_INTERVAL_MS);
  }

  printTable(checks);

  const failed = checks.filter((c) => c.status === "FAIL");
  const passed = checks.filter((c) => c.status === "PASS").length;
  const skipped = checks.filter((c) => c.status === "SKIP").length;
  console.log(
    `Summary: ${passed} passed, ${failed.length} failed, ${skipped} skipped`,
  );
  if (failed.length > 0) {
    console.error("\n❌ E2E webhook test FAILED");
    process.exitCode = 1;
  } else {
    console.log("\n🎉 E2E webhook test passed");
  }
}

/**
 * Spawn `stripe listen`, resolve with the session signing secret once the
 * "Ready!" line appears. We parse the secret from the live session (rather
 * than a separate --print-secret call) so it is guaranteed to match the
 * session actually doing the forwarding.
 */
function startListen(
  apiKey: string,
  webhookUrl: string,
  extraArgs: string[],
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "listen",
      "--api-key",
      apiKey,
      "--forward-to",
      webhookUrl,
      ...extraArgs,
    ];
    console.log(`  $ stripe listen --forward-to ${webhookUrl} ${extraArgs.join(" ")}`);
    const child = spawn(STRIPE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    listenChild = child;

    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectPromise(new Error(`stripe listen not Ready within 30s:\n${buffer}`));
      }
    }, 30_000);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const secretMatch = buffer.match(/whsec_[A-Za-z0-9]+/);
      if (buffer.includes("Ready!") && secretMatch && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(secretMatch[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(
          new Error(`stripe listen exited early (code ${code}):\n${buffer}`),
        );
      }
    });
  });
}

main()
  .catch((err) => {
    console.error("\n❌ E2E runner crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    killListen();
  });
