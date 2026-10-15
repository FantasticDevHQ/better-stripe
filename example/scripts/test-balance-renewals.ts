/** Run real balance-funded store renewals in isolated Stripe sandbox clocks. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { FunctionReturnType } from "convex/server";
import type { internal } from "../convex/_generated/api";

type Snapshot = FunctionReturnType<typeof internal.sandboxRenewals.snapshot>;
type Actor = FunctionReturnType<typeof internal.sandboxRenewals.prepare>;
const runId = process.argv[2] ?? `renewal-${Date.now().toString(36)}`;
function call<T>(name: string, args: object): T {
  const output = execFileSync(
    "pnpm",
    ["exec", "convex", "run", `sandboxRenewals:${name}`, JSON.stringify(args)],
    { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] },
  );
  return (output.trim() ? JSON.parse(output) : null) as T;
}
async function waitFor(
  sellerId: string,
  predicate: (snapshot: Snapshot) => boolean,
  description: string,
): Promise<Snapshot> {
  const deadline = Date.now() + 180000;
  let last: Snapshot | undefined;
  while (Date.now() < deadline) {
    last = call<Snapshot>("snapshot", { sellerId });
    if (predicate(last)) return last;
    await delay(3000);
  }
  throw new Error(`${description} timed out: ${JSON.stringify(last)}`);
}
async function seedCases(actor: Actor, funded: boolean) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return call("seedCases", { sellerId: actor.sellerId, funded });
    } catch (error) {
      const message =
        error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      if (
        !/fees are not available|Charge details are not ready|Test recipient capability pending/.test(
          message,
        ) ||
        attempt === 11
      )
        throw error;
      await delay(5000);
    }
  }
}
const report: Record<string, unknown> = {
  runId,
  startedAt: new Date().toISOString(),
};
async function scenario(name: "funded" | "insufficient") {
  console.log(`[${name}] Creating isolated seller and monthly store plan`);
  const actor = call<Actor>("prepare", { runId, scenario: name });
  const evidence: Record<string, unknown> = { actor };
  report[name] = evidence;
  try {
    const sources = await seedCases(actor, name === "funded");
    evidence.sources = sources;
    const before = await waitFor(
      actor.sellerId,
      (state) =>
        state.costs.some(
          (cost) => cost.sourceType === "refund" && cost.outstanding > 0,
        ) &&
        state.costs.some(
          (cost) => cost.sourceType === "dispute" && cost.outstanding > 0,
        ),
      "Real refund/dispute cost webhooks",
    );
    evidence.before = before;
    const costs = before.costs.reduce((sum, cost) => sum + cost.outstanding, 0);
    const total = 900 + costs;
    assert.equal(before.invoice.status, "paid");
    assert.equal(before.hasAccess, true);
    assert.equal(
      before.costs.reduce((sum, cost) => sum + cost.collected, 0),
      0,
      "Costs must still be outstanding for invoice collection",
    );
    if (name === "funded")
      assert.ok(
        before.available >= total,
        "Funded seller needs sufficient available earned balance",
      );
    else
      assert.ok(
        before.available < total,
        "Failure seller needs insufficient available earned balance",
      );
    console.log(
      `[${name}] Renewing $9 plan plus $${(costs / 100).toFixed(2)} actual refund/dispute costs`,
    );
    call("advance", {
      sellerId: actor.sellerId,
      frozenTime: actor.periodEnd + 1,
    });
    const draft = await waitFor(
      actor.sellerId,
      (state) =>
        state.clockStatus === "ready" &&
        state.invoice.reason === "subscription_cycle" &&
        state.invoice.total === total,
      "Itemized renewal invoice",
    );
    evidence.draft = draft;
    assert.equal(
      draft.costs.reduce((sum, cost) => sum + cost.reserved, 0),
      costs,
    );
    assert.equal(
      draft.costs.reduce((sum, cost) => sum + cost.outstanding, 0),
      0,
    );
    assert.ok(draft.invoice.lines.some((line) => line.amount === 900));
    assert.ok(
      draft.invoice.lines.some(
        (line) => line.amount === costs && /cost/.test(line.description),
      ),
    );
    call("advance", {
      sellerId: actor.sellerId,
      frozenTime: actor.periodEnd + 7201,
    });
    if (name === "funded") {
      const paid = await waitFor(
        actor.sellerId,
        (state) =>
          state.clockStatus === "ready" &&
          state.invoice.status === "paid" &&
          state.hasAccess,
        "Funded renewal payment",
      );
      evidence.paid = paid;
      assert.equal(
        paid.costs.reduce((sum, cost) => sum + cost.collected, 0),
        costs,
      );
      assert.equal(
        paid.costs.reduce((sum, cost) => sum + cost.reserved, 0),
        0,
      );
      assert.equal(paid.invoice.id, draft.invoice.id);
      assert.equal(paid.invoice.amountPaid, total);
      assert.equal(paid.payment.method, "stripe_balance");
      assert.equal(paid.available, before.available - total);
      assert.equal(
        paid.debits.filter((debit) => debit.amount === -total).length,
        1,
      );
      try {
        call("retry", { sellerId: actor.sellerId });
      } catch (error) {
        const message =
          error instanceof Error && "stderr" in error
            ? String(error.stderr)
            : String(error);
        assert.match(message, /Invoice is already paid/);
        evidence.paidRetryResult =
          "Stripe rejected retry because the invoice is already paid";
      }
      const retried = call<Snapshot>("snapshot", { sellerId: actor.sellerId });
      assert.equal(
        retried.available,
        paid.available,
        "Retrying a paid invoice must not debit twice",
      );
      evidence.paidRetry = retried;
      console.log(
        `[${name}] PASS: one $${(total / 100).toFixed(2)} Stripe balance debit, renewal active, paid retry caused no duplicate debit`,
      );
    } else {
      const failed = await waitFor(
        actor.sellerId,
        (state) =>
          state.clockStatus === "ready" &&
          state.invoice.status === "open" &&
          (state.payment.declineCode === "insufficient_funds" ||
            state.payment.errorCode === "insufficient_funds"),
        "Insufficient balance failure",
      );
      evidence.failed = failed;
      assert.equal(failed.invoice.id, draft.invoice.id);
      assert.equal(failed.invoice.amountPaid, 0);
      assert.equal(failed.payment.method, "stripe_balance");
      assert.equal(failed.invoice.amountRemaining, total);
      assert.equal(failed.available, before.available);
      assert.equal(failed.debits.length, 0);
      assert.equal(
        failed.hasAccess,
        false,
        "An unpaid renewal must close the store after its paid period expires",
      );
      assert.equal(
        failed.costs.reduce((sum, cost) => sum + cost.reserved, 0),
        costs,
      );
      console.log(
        `[${name}] Failure confirmed. Adding real payment earnings and retrying the same invoice`,
      );
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          call("fund", { sellerId: actor.sellerId });
          break;
        } catch (error) {
          if (attempt === 11) throw error;
          await delay(5000);
        }
      }
      const funded = call<Snapshot>("snapshot", { sellerId: actor.sellerId });
      evidence.funded = funded;
      call("retry", { sellerId: actor.sellerId });
      const recovered = await waitFor(
        actor.sellerId,
        (state) =>
          state.invoice.status === "paid" &&
          (state.hasAccess || state.subscriptionStatus === "canceled"),
        "Recovery after earnings arrive",
      );
      evidence.recovered = recovered;
      assert.equal(recovered.invoice.id, failed.invoice.id);
      assert.equal(recovered.invoice.total, total);
      assert.equal(recovered.payment.method, "stripe_balance");
      assert.equal(recovered.available, funded.available - total);
      assert.equal(
        recovered.debits.filter((debit) => debit.amount === -total).length,
        1,
      );
      assert.equal(
        recovered.costs.reduce((sum, cost) => sum + cost.reserved, 0),
        0,
      );
      assert.equal(
        recovered.costs.reduce((sum, cost) => sum + cost.collected, 0),
        costs,
        "Already invoiced costs must not also be withheld from new earnings",
      );
      if (recovered.subscriptionStatus === "canceled") {
        assert.equal(recovered.hasAccess, false);
        evidence.recoveryLimitation =
          "Stripe canceled this subscription after payment failure. Paying its outstanding invoice does not reactivate a canceled subscription. Configure recovery settings to retain the subscription during retries.";
      } else {
        assert.equal(recovered.hasAccess, true);
      }
      console.log(
        `[${name}] PASS: insufficient funds caused no debit; retry collected the same invoice once. Access ${recovered.hasAccess ? "restored" : "stays closed because Stripe canceled the subscription"}.`,
      );
    }
  } finally {
    try {
      call("finish", { sellerId: actor.sellerId });
    } catch (error) {
      evidence.cleanupError = String(error);
    }
  }
}
try {
  report.webhooks = call("preflight", {});
  const selected = process.argv[3];
  if (selected && selected !== "funded" && selected !== "insufficient")
    throw new Error("Scenario must be funded or insufficient.");
  if (!selected || selected === "funded") await scenario("funded");
  if (!selected || selected === "insufficient") await scenario("insufficient");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error && "stderr" in error
      ? String(error.stderr)
      : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  mkdirSync("qa/2026-10-13", { recursive: true });
  const path = `qa/2026-10-13/balance-renewals-${runId}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`Evidence saved to ${path}`);
}
