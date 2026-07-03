// @vitest-environment edge-runtime
/**
 * BTS-63 — transfer-reversal race reproductions.
 *
 * Integration tests: the REAL client orchestration (reverseTransfers /
 * reverseTransfersForRefund) runs against the REAL component ledger
 * (convex-test), with a fake Stripe that models the documented idempotency
 * semantics (docs.stripe.com/api/idempotent_requests):
 *  - same key + identical params  → cached replay, no money moves
 *  - same key + different params  → hard idempotency_error
 *  - network failure              → nothing cached; a retry executes fresh
 *
 * The fake also gates createReversal so tests can pin the exact interleaving
 * (read → compute → Stripe call → record) that produces each race.
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../client/helpers.js";
import {
  reverseTransfers,
  reverseTransfersForRefund,
} from "../client/connect/transfers.js";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

const TO_REF = Symbol.for("toReferencePath");

/**
 * Component mock whose every node carries the accumulated reference path, so
 * componentRef() resolves any function path without enumerating them here.
 */
function proxyComponent(base = "betterStripe"): Component {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === TO_REF) return base;
        if (typeof prop !== "string") return undefined;
        return proxyComponent(`${base}/${prop}`);
      },
    },
  ) as unknown as Component;
}

/** Map a componentRef result onto the generated api for convex-test. */
function refToApi(refObj: unknown): unknown {
  const path = (refObj as Record<symbol, string>)[TO_REF].replace(
    /^betterStripe\//,
    "",
  );
  return path
    .split("/")
    .reduce(
      (node, seg) => (node as Record<string, unknown>)[seg],
      api as unknown,
    );
}

/** RunCtx whose runQuery/runMutation execute against a convex-test instance. */
function makeCtx(t: ReturnType<typeof convexTest>): RunCtx {
  const query = t.query as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  const mutation = t.mutation as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  return {
    runQuery: (ref: unknown, args: unknown) => query(refToApi(ref), args),
    runMutation: (ref: unknown, args: unknown) => mutation(refToApi(ref), args),
  } as unknown as RunCtx;
}

/**
 * Fake Stripe transfers API with real idempotency semantics plus a gate that
 * lets a test hold calls in flight to force a specific interleaving.
 */
function makeRacingStripe() {
  const keys = new Map<string, { params: string; response: unknown }>();
  const totals = new Map<string, number>();
  const failOnce = new Set<string>();
  let gateOpen = true;
  let waiters: (() => void)[] = [];
  let blockedCount = 0;

  const stripe = {
    transfers: {
      createReversal: vi.fn(
        async (
          transferId: string,
          params: { amount: number },
          opts?: { idempotencyKey?: string },
        ) => {
          if (!gateOpen) {
            blockedCount++;
            await new Promise<void>((res) => waiters.push(res));
          }
          if (failOnce.has(transferId)) {
            failOnce.delete(transferId);
            // Connection-level failure: Stripe caches nothing, so a retry
            // with the same key executes fresh.
            throw new Error(`stripe: network error reversing ${transferId}`);
          }
          const key = opts?.idempotencyKey;
          const paramStr = JSON.stringify(params);
          if (key) {
            const seen = keys.get(key);
            if (seen) {
              if (seen.params !== paramStr) {
                throw new Error(
                  `stripe: idempotency_error — key ${key} reused with different params`,
                );
              }
              return seen.response; // cached replay — no money moves
            }
          }
          totals.set(transferId, (totals.get(transferId) ?? 0) + params.amount);
          const response = { id: `trr_${keys.size}_${transferId}` };
          if (key) keys.set(key, { params: paramStr, response });
          return response;
        },
      ),
      retrieve: vi.fn(async (transferId: string) => ({
        id: transferId,
        amount_reversed: totals.get(transferId) ?? 0,
      })),
    },
    failNextCallFor: (transferId: string) => failOnce.add(transferId),
    closeGate: () => {
      gateOpen = false;
    },
    openGate: () => {
      gateOpen = true;
      const w = waiters;
      waiters = [];
      blockedCount = 0;
      w.forEach((res) => res());
    },
    blocked: () => blockedCount,
    total: (transferId: string) => totals.get(transferId) ?? 0,
  };
  return stripe;
}

const asStripe = (s: ReturnType<typeof makeRacingStripe>) =>
  s as unknown as Parameters<typeof reverseTransfers>[0];

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function seedLeg(
  t: ReturnType<typeof convexTest>,
  args: { stripeTransferId: string; sourceChargeId: string; amount: number },
) {
  await t.mutation(api.connect.mutations.upsertTransfer, {
    ...args,
    destinationAccountId: `acct_${args.stripeTransferId}`,
    currency: "usd",
    role: "store" as const,
    status: "paid" as const,
  });
}

describe("BTS-63 race 1 — refund path: concurrent DISTINCT refunds must not double-reverse", () => {
  it("two refunds computing the same target from the same pre-write state reverse it once", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    // Charge 10000, single split leg of 7000.
    await seedLeg(t, {
      stripeTransferId: "tr_store",
      sourceChargeId: "ch_race",
      amount: 7000,
    });

    // Refunds A and B (2000 each) land back-to-back: both refund.created
    // handlers fresh-read the charge and see cumulative amount_refunded=4000,
    // so both compute the same cumulative target round(7000 × 0.4) = 2800.
    const opts = {
      sourceChargeId: "ch_race",
      chargeAmount: 10000,
      amountRefunded: 4000,
    };

    // Hold Stripe calls so both handlers pass their read-and-compute step
    // before either records anything.
    stripe.closeGate();
    const pA = reverseTransfersForRefund(asStripe(stripe), component, ctx, {
      ...opts,
      refundId: "re_A",
    });
    await waitFor(() => stripe.blocked() >= 1, "refund A to reach Stripe");

    let bSettled = false;
    const pB = reverseTransfersForRefund(asStripe(stripe), component, ctx, {
      ...opts,
      refundId: "re_B",
    }).finally(() => {
      bSettled = true;
    });
    // B either reaches Stripe too (the racy pre-fix behavior) or finishes
    // without a Stripe call (the fixed behavior — its claim comes back empty).
    await waitFor(
      () => stripe.blocked() >= 2 || bSettled,
      "refund B to reach Stripe or settle",
    );

    stripe.openGate();
    await Promise.all([pA, pB]);

    // 40% of the 7000 leg is 2800 — reversed exactly once across both refunds.
    expect(stripe.total("tr_store")).toBe(2800);

    // And the ledger mirrors what actually moved on Stripe.
    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_race",
    });
    expect(rows[0]!.reversedAmount).toBe(2800);
    expect(rows[0]!.reversedAmount).toBe(stripe.total("tr_store"));
  });
});

describe("BTS-63 race 2 — dispute path: retry after partial success must converge", () => {
  const DISPUTE = { sourceChargeId: "ch_dp", amount: 4500, operationId: "dp_1" };

  async function seedDisputeLegs(t: ReturnType<typeof convexTest>) {
    await seedLeg(t, {
      stripeTransferId: "tr_s1",
      sourceChargeId: "ch_dp",
      amount: 8000,
    });
    await seedLeg(t, {
      stripeTransferId: "tr_s2",
      sourceChargeId: "ch_dp",
      amount: 1000,
    });
  }

  it("a redelivery after the second leg failed does not double-record the first leg", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();
    await seedDisputeLegs(t);

    // First delivery: leg 1 (pro-rata 4000) reverses and records, leg 2's
    // Stripe call dies → the event fails and Stripe redelivers.
    stripe.failNextCallFor("tr_s2");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, DISPUTE),
    ).rejects.toThrow(/network error/);
    expect(stripe.total("tr_s1")).toBe(4000);

    // Redelivery: must finish the job — leg 2 gets its 500 — without
    // re-reversing or double-recording leg 1.
    await reverseTransfers(asStripe(stripe), component, ctx, DISPUTE);

    expect(stripe.total("tr_s1")).toBe(4000);
    expect(stripe.total("tr_s2")).toBe(500);

    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_dp",
    });
    const byId = new Map(rows.map((r) => [r.stripeTransferId, r]));
    // Pre-fix, the replayed leg-1 call re-records cumulatively: 4000 → 8000.
    expect(byId.get("tr_s1")!.reversedAmount).toBe(4000);
    expect(byId.get("tr_s2")!.reversedAmount).toBe(500);
  });

  it("a redelivery after an interleaved reversal must not reuse a key with different params", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();
    await seedDisputeLegs(t);

    // First delivery: leg 1 reverses 4000 and records; leg 2 fails.
    stripe.failNextCallFor("tr_s2");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, DISPUTE),
    ).rejects.toThrow(/network error/);

    // Between deliveries a refund clawback confirms more reversal on leg 1,
    // shrinking its un-reversed remainder from 4000 to 2000.
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_s1",
      reversedAmount: 6000,
    });

    // Redelivery: pre-fix this recomputes leg 1's amount as min(4000, 2000)
    // = 2000 and re-sends it under the already-used bs_rev_dp_1_tr_s1 key —
    // Stripe rejects same-key-different-params and the event retries forever.
    await reverseTransfers(asStripe(stripe), component, ctx, DISPUTE);

    // Leg 1's share was already executed on the first delivery; only leg 2
    // still had money to move.
    expect(stripe.total("tr_s1")).toBe(4000);
    expect(stripe.total("tr_s2")).toBe(500);
  });
});
