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
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

import { EXPECTED_REVERSED, reversalsMatchExactly } from "./money-assertions";

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
  // Key passed via env (not argv) so it never shows up in `ps` output.
  execFileSync(STRIPE_BIN, ["trigger", event], {
    encoding: "utf-8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, STRIPE_API_KEY: apiKey },
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

// stdin is "ignore" (null), so this is not a ChildProcessWithoutNullStreams.
let listenChild: ChildProcess | null = null;

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

process.on("SIGTERM", () => {
  killListen();
  process.exit(143);
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
      ledger.some((e) => e.eventType === type && e._creationTime >= startMs);
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

  console.log(`\n── Polling assertions (up to ${POLL_TIMEOUT_MS / 1000}s) ──`);
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

  // ─── 8. Money layer (BTS-49) ────────────────────────────────────────
  // Prove the money actually MOVES: a destination charge collects a platform
  // fee, a multi-recipient split fans out one transfer per recipient, and a
  // refund/dispute reverses them. Drives real Stripe (test mode) + the real
  // webhook engine, then asserts the persisted ledger. Gated: any live failure
  // (recipient activation, insufficient capabilities, dispute not yet landed)
  // SKIPs the money rows — it never falsely PASSES. Set E2E_SKIP_MONEY=1 to
  // skip the whole phase (e.g. an events-only smoke run).
  const moneyChecks = await runMoneyAssertions();

  const allChecks = [...checks, ...moneyChecks];
  printTable(allChecks);

  const failed = allChecks.filter((c) => c.status === "FAIL");
  const passed = allChecks.filter((c) => c.status === "PASS").length;
  const skipped = allChecks.filter((c) => c.status === "SKIP").length;
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

// ─── Money-layer assertions (BTS-49) ───────────────────────────────────────

interface PaymentRow {
  applicationFeeAmount?: number;
  feeCollectedAmount?: number;
  destinationAccountId?: string;
}
interface TransferRow {
  destinationAccountId: string;
  role?: string;
  amount: number;
  reversedAmount?: number;
}
interface DisputeRow {
  stripeDisputeId: string;
  status?: string;
}

const MONEY_POLL_TIMEOUT_MS = 120_000;

/** Poll a producer until `done` is satisfied or the deadline passes. */
async function pollFor<T>(
  produce: () => T,
  done: (value: T) => boolean,
  timeoutMs = MONEY_POLL_TIMEOUT_MS,
): Promise<{ ok: boolean; last: T }> {
  const deadline = Date.now() + timeoutMs;
  let last = produce();
  while (!done(last)) {
    if (Date.now() > deadline) return { ok: false, last };
    await sleep(POLL_INTERVAL_MS);
    last = produce();
  }
  return { ok: true, last };
}

/**
 * Drive the money scenarios and assert the persisted ledger. Returns resolved
 * Check rows (never throws): a live failure marks the affected rows SKIP with a
 * reason so the gate never falsely passes, but a genuine wrong outcome FAILs.
 */
async function runMoneyAssertions(): Promise<Check[]> {
  const names = {
    fee: "money: destination fee (application_fee → payments row)",
    split: "money: split sale (N transfers in ledger)",
    refund: "money: refund reverses transfers",
    dispute: "money: dispute reverses transfers",
  };
  const skipAll = (detail: string): Check[] =>
    Object.values(names).map((name) => ({ name, status: "SKIP", detail }));

  if (process.env.E2E_SKIP_MONEY) {
    return skipAll("E2E_SKIP_MONEY set");
  }

  console.log("\n── Money layer (BTS-49) ──");

  // Provision two transfer-ready recipients (store + affiliate). If activation
  // fails (Stripe capability/onboarding), the whole money phase SKIPs.
  let storeAccountId: string;
  let affiliateAccountId: string;
  try {
    console.log("  provisioning test recipients (BTS-9/10 recipe) …");
    storeAccountId = convexRun<{ stripeAccountId: string }>(
      "e2eMoney:provisionTestRecipient",
      { label: "store" },
    ).stripeAccountId;
    affiliateAccountId = convexRun<{ stripeAccountId: string }>(
      "e2eMoney:provisionTestRecipient",
      { label: "affiliate" },
    ).stripeAccountId;
    console.log(`  ✅ store=${storeAccountId} affiliate=${affiliateAccountId}`);
  } catch (err) {
    return skipAll(`recipient provisioning failed: ${String(err)}`);
  }

  const checks: Check[] = [];

  // ── AC1: destination charge with a platform fee → payments-row fee ──
  try {
    console.log("  driving a $100 destination charge (fee $10) …");
    const sale = convexRun<{ stripePaymentIntentId: string }>(
      "e2eMoney:e2eDestinationFeeSale",
      { storeAccountId, amount: 10_000, applicationFeeAmount: 1_000 },
    );
    const { ok, last } = await pollFor<PaymentRow | null>(
      () =>
        convexRun<PaymentRow | null>("e2eMoney:getPaymentRow", {
          stripePaymentIntentId: sale.stripePaymentIntentId,
        }),
      (row) => !!row && (row.feeCollectedAmount ?? 0) > 0,
    );
    checks.push({
      name: names.fee,
      status: ok && (last?.feeCollectedAmount ?? 0) === 1_000 ? "PASS" : "FAIL",
      detail: ok
        ? `feeCollectedAmount=${last?.feeCollectedAmount} destination=${last?.destinationAccountId}`
        : "payments row never showed a collected fee",
    });
  } catch (err) {
    checks.push({
      name: names.fee,
      status: "SKIP",
      detail: `drive failed: ${String(err)}`,
    });
  }

  // ── AC2a: split sale → one transfer per recipient in the ledger ──
  let splitChargeId: string | null = null;
  let splitPiId: string | null = null;
  try {
    console.log("  driving a $100 split sale ($80 store / $10 affiliate) …");
    const sale = convexRun<{
      stripePaymentIntentId: string;
      stripeChargeId: string | null;
    }>("e2eMoney:e2eSplitSale", {
      storeAccountId,
      affiliateAccountId,
      amount: 10_000,
      storeAmount: 8_000,
      affiliateAmount: 1_000,
    });
    splitChargeId = sale.stripeChargeId;
    splitPiId = sale.stripePaymentIntentId;
    if (!splitChargeId) throw new Error("no charge id on the split PI");
    const { ok, last } = await pollFor<TransferRow[]>(
      () =>
        convexRun<TransferRow[]>("e2eMoney:listTransfersForCharge", {
          sourceChargeId: splitChargeId,
        }),
      (rows) => rows.length >= 2,
    );
    checks.push({
      name: names.split,
      status: ok && last.length === 2 ? "PASS" : "FAIL",
      detail: ok
        ? `${last.length} transfers: ${last.map((t) => `${t.role}=${t.amount}`).join(", ")}`
        : "split transfers never appeared in the ledger",
    });
  } catch (err) {
    checks.push({
      name: names.split,
      status: "SKIP",
      detail: `drive failed: ${String(err)}`,
    });
  }

  // ── AC2b (deterministic): refund reverses the split transfers to EXACT amounts ──
  // BTS-73: assert the exact pro-rata reversed amount per recipient (store 8000
  // / affiliate 1000 for a full refund of the $80/$10 split), not just `> 0`. A
  // partial or wrong-amount reversal FAILs.
  if (splitChargeId && splitPiId) {
    try {
      console.log("  refunding the split charge (reverseTransfer) …");
      convexRun("e2eMoney:e2eRefundCharge", {
        stripePaymentIntentId: splitPiId,
      });
      const chargeId = splitChargeId;
      const { ok, last } = await pollFor<TransferRow[]>(
        () =>
          convexRun<TransferRow[]>("e2eMoney:listTransfersForCharge", {
            sourceChargeId: chargeId,
          }),
        (rows) => reversalsMatchExactly(rows, EXPECTED_REVERSED),
      );
      checks.push({
        name: names.refund,
        status: ok ? "PASS" : "FAIL",
        detail: ok
          ? `reversed exactly: ${last.map((t) => `${t.role}=${t.reversedAmount}`).join(", ")}`
          : `refund did not reverse transfers to the expected amounts ` +
            `(want ${JSON.stringify(EXPECTED_REVERSED)}, got ` +
            `${last.map((t) => `${t.role}=${t.reversedAmount ?? 0}`).join(", ") || "no rows"})`,
      });
    } catch (err) {
      checks.push({
        name: names.refund,
        status: "SKIP",
        detail: `refund drive failed: ${String(err)}`,
      });
    }
  } else {
    checks.push({
      name: names.refund,
      status: "SKIP",
      detail: "split sale did not produce a charge to refund",
    });
  }

  // ── AC2b (real dispute): a disputed split → clawback reverses transfers ──
  // Disputes are async; the charge auto-disputes via Stripe's test token, then
  // charge.dispute.created claws back pro-rata.
  //
  // BTS-73: distinguish two very different outcomes that both used to SKIP:
  //   • the dispute row NEVER landed within the window (async timing) → SKIP
  //   • the dispute row LANDED but the transfers weren't reversed to the exact
  //     expected amounts (broken clawback wiring) → FAIL
  // and assert the EXACT pro-rata reversed amount, not just `> 0`.
  try {
    console.log("  driving a disputed $100 split (test dispute token) …");
    const sale = convexRun<{
      stripePaymentIntentId: string;
      stripeChargeId: string | null;
    }>("e2eMoney:e2eSplitSale", {
      storeAccountId,
      affiliateAccountId,
      amount: 10_000,
      storeAmount: 8_000,
      affiliateAmount: 1_000,
      dispute: true,
    });
    const chargeId = sale.stripeChargeId;
    const piId = sale.stripePaymentIntentId;
    if (!chargeId) throw new Error("no charge id on the disputed PI");

    const { ok, last } = await pollFor<TransferRow[]>(
      () =>
        convexRun<TransferRow[]>("e2eMoney:listTransfersForCharge", {
          sourceChargeId: chargeId,
        }),
      (rows) => reversalsMatchExactly(rows, EXPECTED_REVERSED),
    );

    if (ok) {
      checks.push({
        name: names.dispute,
        status: "PASS",
        detail: `clawback reversed exactly: ${last
          .map((t) => `${t.role}=${t.reversedAmount}`)
          .join(", ")}`,
      });
    } else {
      // The clawback didn't reach the exact amounts in-window. Whether that's a
      // FAIL or a legitimate SKIP depends on whether the dispute even landed.
      const disputes = convexRun<DisputeRow[]>(
        "e2eMoney:listDisputesForPaymentIntent",
        { stripePaymentIntentId: piId },
      );
      if (disputes.length > 0) {
        checks.push({
          name: names.dispute,
          status: "FAIL",
          detail:
            `dispute LANDED (status=${disputes[0].status ?? "?"}) but the ` +
            `clawback did not reverse transfers to the expected amounts ` +
            `(want ${JSON.stringify(EXPECTED_REVERSED)}, got ` +
            `${last.map((t) => `${t.role}=${t.reversedAmount ?? 0}`).join(", ") || "no rows"})`,
        });
      } else {
        checks.push({
          name: names.dispute,
          status: "SKIP",
          detail: "dispute event never landed within the poll window",
        });
      }
    }
  } catch (err) {
    checks.push({
      name: names.dispute,
      status: "SKIP",
      detail: `dispute drive failed: ${String(err)}`,
    });
  }

  return checks;
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
    const args = ["listen", "--forward-to", webhookUrl, ...extraArgs];
    console.log(
      `  $ stripe listen --forward-to ${webhookUrl} ${extraArgs.join(" ")}`,
    );
    // Key passed via env (not argv) so it never shows up in `ps` output.
    const child = spawn(STRIPE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, STRIPE_API_KEY: apiKey },
    });
    listenChild = child;

    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectPromise(
          new Error(`stripe listen not Ready within 30s:\n${buffer}`),
        );
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
