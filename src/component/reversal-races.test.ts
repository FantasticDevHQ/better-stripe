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
  listWedgedReversalClaims,
  reclaimReversalClaim,
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

describe("BTS-63 race 3 — a transiently-failed operation must not be leapfrogged by a sibling", () => {
  // The hole-leapfrog regression (independent PR #61 review, BLOCKER 1): an
  // operation claims a slice, its Stripe call fails transiently, and a SIBLING
  // operation claims the next slice and confirms past the hole. The failed
  // operation's retry then sees `confirmed >= to` and silently skips — its
  // money never moves, the ledger overstates the reversal, and the
  // claimed>confirmed marker is erased. The executor must refuse to run a
  // slice whose predecessor claim is unexecuted, so events retry until the
  // hole is filled and every claimed slice eventually moves.

  it("refund path: R1 fails once, R2 lands, R1 retries — every claimed slice still moves", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_leap",
      sourceChargeId: "ch_leap",
      amount: 7000,
    });

    // R1 (cumulative refunded 4000/10000 → target 2800) claims [0,2800) but
    // its Stripe call dies on a transient network error → the event retries.
    stripe.failNextCallFor("tr_leap");
    const r1 = () =>
      reverseTransfersForRefund(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_leap",
        refundId: "re_A",
        chargeAmount: 10000,
        amountRefunded: 4000,
      });
    await expect(r1()).rejects.toThrow(/network error/);
    expect(stripe.total("tr_leap")).toBe(0);

    // R2 (cumulative refunded 8000 → target 5600) lands before R1's retry and
    // claims [2800,5600). It must NOT execute past R1's unexecuted hole —
    // pre-gate it did, confirming the ledger to 5600 with only 2800 moved.
    const r2 = () =>
      reverseTransfersForRefund(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_leap",
        refundId: "re_B",
        chargeAmount: 10000,
        amountRefunded: 8000,
      });
    await r2().catch(() => {}); // blocked (fixed) or leapfrogs (the bug)

    // At-least-once delivery: both events retry until they succeed.
    await r1();
    await r2();

    // 80% of the 7000 leg = 5600 actually reversed at Stripe, and the ledger
    // mirrors what actually moved — no silent lost clawback.
    expect(stripe.total("tr_leap")).toBe(5600);
    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_leap",
    });
    expect(rows[0]!.reversedAmount).toBe(stripe.total("tr_leap"));
  });

  it("dispute path: the clawback fails once, a refund confirms past it, the redelivery still claws back", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_lp2",
      sourceChargeId: "ch_lp2",
      amount: 8000,
    });

    // Dispute clawback (amount 4000) claims [0,4000); its Stripe call dies.
    stripe.failNextCallFor("tr_lp2");
    const clawback = () =>
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_lp2",
        amount: 4000,
        operationId: "dp_leap",
      });
    await expect(clawback()).rejects.toThrow(/network error/);

    // A refund (6000/10000 → target 4800) claims [4000,4800) behind the hole.
    const refund = () =>
      reverseTransfersForRefund(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_lp2",
        refundId: "re_C",
        chargeAmount: 10000,
        amountRefunded: 6000,
      });
    await refund().catch(() => {});

    // Both events retry until they succeed.
    await clawback();
    await refund();

    expect(stripe.total("tr_lp2")).toBe(4800);
    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_lp2",
    });
    expect(rows[0]!.reversedAmount).toBe(stripe.total("tr_lp2"));
  });
});

describe("BTS-74 — reclaim/expiry of dead reversal claims", () => {
  const DAY = 24 * 60 * 60 * 1000;

  // A permanently-dead claim: an operation claims a slice, its Stripe call
  // dies, and — unlike the transient case (race 3) — its webhook event is never
  // redelivered (Stripe's ~72h retries exhaust). The claim frontier then sits
  // ahead of the confirmed reversedAmount forever, and any successor operation
  // that claimed behind the hole blocks on `predecessor claim unexecuted`.

  it("re-executes a dead claim, filling the hole so a blocked successor can proceed", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_dead",
      sourceChargeId: "ch_dead",
      amount: 7000,
    });

    // D1 (dispute clawback, amount 2800) claims [0,2800); its Stripe call dies
    // and the event is NEVER redelivered — a permanently-dead claim.
    stripe.failNextCallFor("tr_dead");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_dead",
        amount: 2800,
        operationId: "dp_dead",
      }),
    ).rejects.toThrow(/network error/);
    expect(stripe.total("tr_dead")).toBe(0);

    // A refund (target 5600) claims [2800,5600) behind the hole and BLOCKS —
    // its predecessor's claim is unexecuted.
    await expect(
      reverseTransfersForRefund(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_dead",
        refundId: "re_after",
        chargeAmount: 10000,
        amountRefunded: 8000,
      }),
    ).rejects.toThrow(/predecessor claim unexecuted/);

    // Ops reclaim: re-execute the dead claim (default remedy). It replays the
    // recorded slice under the same idempotency key and actually moves the money.
    const res = await reclaimReversalClaim(asStripe(stripe), component, ctx, {
      operationId: "dp_dead",
    });
    expect(res.mode).toBe("reexecute");
    expect(stripe.total("tr_dead")).toBe(2800);

    // The successor refund now proceeds — the hole is filled.
    await reverseTransfersForRefund(asStripe(stripe), component, ctx, {
      sourceChargeId: "ch_dead",
      refundId: "re_after",
      chargeAmount: 10000,
      amountRefunded: 8000,
    });
    expect(stripe.total("tr_dead")).toBe(5600);

    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_dead",
    });
    expect(rows[0]!.reversedAmount).toBe(5600);
    // No longer wedged.
    const wedged = await listWedgedReversalClaims(component, ctx);
    expect(wedged).toHaveLength(0);
  });

  it("lists a wedged leg (claimed > reversed) with its blocking op record", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_wedge",
      sourceChargeId: "ch_wedge",
      amount: 5000,
    });

    stripe.failNextCallFor("tr_wedge");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_wedge",
        amount: 2000,
        operationId: "dp_wedge",
      }),
    ).rejects.toThrow(/network error/);

    const wedged = await listWedgedReversalClaims(component, ctx);
    expect(wedged).toHaveLength(1);
    expect(wedged[0]!.stripeTransferId).toBe("tr_wedge");
    expect(wedged[0]!.reversedAmount).toBe(0);
    expect(wedged[0]!.reversalClaimedAmount).toBe(2000);
    expect(wedged[0]!.blockingOps).toEqual([
      { operationId: "dp_wedge", from: 0, to: 2000 },
    ]);
  });

  it("releases a dead frontier claim after the idempotency window once live Stripe confirms no money moved", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_rel",
      sourceChargeId: "ch_rel",
      amount: 6000,
    });

    stripe.failNextCallFor("tr_rel");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_rel",
        amount: 3000,
        operationId: "dp_rel",
      }),
    ).rejects.toThrow(/network error/);

    // Release: past the >24h idempotency window, and live Stripe shows the
    // transfer's amount_reversed is still 0 — the money never moved.
    const res = await reclaimReversalClaim(asStripe(stripe), component, ctx, {
      operationId: "dp_rel",
      mode: "release",
      minAgeMs: DAY,
      now: Date.now() + 2 * DAY,
    });
    expect(res.mode).toBe("release");
    if (res.mode === "release") expect(res.released).toBe(true);

    // The op record is gone and the claim frontier rewound to the confirmed
    // amount, so a fresh operation can claim the released capacity from 0.
    const op = await t.query(api.connect.queries.getReversalOp, {
      operationId: "dp_rel",
    });
    expect(op).toBeNull();
    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_rel",
    });
    expect(rows[0]!.reversalClaimedAmount ?? 0).toBe(0);

    const fresh = await reverseTransfers(asStripe(stripe), component, ctx, {
      sourceChargeId: "ch_rel",
      amount: 3000,
      operationId: "dp_fresh",
    });
    expect(fresh.reversals[0]!.amount).toBe(3000);
    expect(stripe.total("tr_rel")).toBe(3000);
  });

  it("refuses to release a still-live claim inside the idempotency window (money may be in flight)", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_live",
      sourceChargeId: "ch_live",
      amount: 6000,
    });

    stripe.failNextCallFor("tr_live");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_live",
        amount: 3000,
        operationId: "dp_live",
      }),
    ).rejects.toThrow(/network error/);

    // Only ~1 minute old: still within the idempotency window, so a retry could
    // still fire the reversal. Release must refuse.
    await expect(
      reclaimReversalClaim(asStripe(stripe), component, ctx, {
        operationId: "dp_live",
        mode: "release",
        minAgeMs: DAY,
        now: Date.now() + 60_000,
      }),
    ).rejects.toThrow(/idempotency window|too recent/i);

    // The claim is untouched — still wedged, still recorded.
    const wedged = await listWedgedReversalClaims(component, ctx);
    expect(wedged).toHaveLength(1);
    const op = await t.query(api.connect.queries.getReversalOp, {
      operationId: "dp_live",
    });
    expect(op).not.toBeNull();
  });

  it("refuses to release when live Stripe shows the money already moved", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();

    await seedLeg(t, {
      stripeTransferId: "tr_moved",
      sourceChargeId: "ch_moved",
      amount: 6000,
    });

    // The claim's money DID move at Stripe, but the ledger confirm was lost
    // (crash between createReversal and recordTransferReversal): the op row and
    // the claim frontier exist, but amount_reversed already covers the slice.
    stripe.failNextCallFor("tr_moved");
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: "ch_moved",
        amount: 3000,
        operationId: "dp_moved",
      }),
    ).rejects.toThrow(/network error/);
    // Simulate the money having actually moved out of band.
    await stripe.transfers.createReversal(
      "tr_moved",
      { amount: 3000 },
      { idempotencyKey: "out_of_band" },
    );
    expect(stripe.total("tr_moved")).toBe(3000);

    // Release must refuse — releasing here would rewind a claim whose money is
    // gone, permanently understating the ledger. Re-execution (which records
    // the already-moved money) is the correct remedy.
    await expect(
      reclaimReversalClaim(asStripe(stripe), component, ctx, {
        operationId: "dp_moved",
        mode: "release",
        minAgeMs: DAY,
        now: Date.now() + 2 * DAY,
      }),
    ).rejects.toThrow(/already moved|money moved/i);
  });
});

describe("BTS-79 — releaseReversalClaim: multi-leg all-or-nothing atomicity", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /**
   * Seeds two legs under one charge and creates ONE dead reversal op whose
   * plan spans both: with leg amounts 100/300 and a claim of `amount: 398`,
   * `computeReversalSlices`'s pro-rata rounding claims leg A FULLY (100 of
   * 100 — its prorata share rounds up to its cap) while leg B is left
   * PARTIAL (298 of 300, capped by the remaining budget). Both legs'
   * Stripe calls die (network error), so neither leg's money actually moves
   * — the op is a permanently-dead claim, same shape as the BTS-74 tests
   * above, but with two legs instead of one.
   *
   * This shared base state is valid-and-releasable for BOTH legs as-is; each
   * test below invalidates leg B in exactly one way (one of the three throw
   * branches in `releaseReversalClaim`, mutations.ts ~527-545) and asserts
   * that the *entire* release is refused and *neither* leg's row nor the op
   * row changed even one field — true all-or-nothing.
   */
  async function seedMixedOp(
    stripe: ReturnType<typeof makeRacingStripe>,
    t: ReturnType<typeof convexTest>,
    ctx: RunCtx,
    component: Component,
    tag: string,
  ) {
    const chargeId = `ch_mix_${tag}`;
    const legA = `tr_mixA_${tag}`;
    const legB = `tr_mixB_${tag}`;
    const operationId = `dp_mix_${tag}`;

    await seedLeg(t, {
      stripeTransferId: legA,
      sourceChargeId: chargeId,
      amount: 100,
    });
    await seedLeg(t, {
      stripeTransferId: legB,
      sourceChargeId: chargeId,
      amount: 300,
    });

    // Only leg A's call needs to fail: it is processed first (rows come back
    // in seed order), so its network error aborts the executor loop before
    // leg B's Stripe call is ever attempted — leg B's `failNextCallFor` flag
    // would otherwise sit unconsumed and misfire on a later, unrelated call.
    stripe.failNextCallFor(legA);
    await expect(
      reverseTransfers(asStripe(stripe), component, ctx, {
        sourceChargeId: chargeId,
        amount: 398,
        operationId,
      }),
    ).rejects.toThrow(/network error/);
    expect(stripe.total(legA)).toBe(0);
    expect(stripe.total(legB)).toBe(0);

    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: chargeId,
    });
    const byId = new Map(rows.map((r) => [r.stripeTransferId, r]));
    expect(byId.get(legA)!.reversalClaimedAmount).toBe(100);
    expect(byId.get(legB)!.reversalClaimedAmount).toBe(298);

    return { chargeId, legA, legB, operationId };
  }

  async function snapshot(
    t: ReturnType<typeof convexTest>,
    chargeId: string,
    operationId: string,
  ) {
    const rows = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: chargeId,
    });
    const op = await t.query(api.connect.queries.getReversalOp, {
      operationId,
    });
    return { rows, op };
  }

  it("leg A valid + leg B's claim frontier moved past this op's slice (mutations.ts ~527-533) — refuses, rewinds neither leg", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();
    const { chargeId, legB, operationId } = await seedMixedOp(
      stripe,
      t,
      ctx,
      component,
      "frontier",
    );

    // A successor operation claims further capacity on the same charge. Leg A
    // is already fully claimed, so its take is capped at 0 by ANY mode
    // (`leg.amount - from` = 0) — it is untouched. Leg B still has 2 left, so
    // this advances its frontier from 298 to 299, past dp_mix_frontier's
    // recorded slice.to=298 for leg B. This is a pure claim (no Stripe call),
    // exactly what a real concurrent operation would do.
    await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_successor_frontier",
      sourceChargeId: chargeId,
      mode: { kind: "amount", amount: 1 },
    });
    const afterSuccessor = await t.query(
      api.connect.queries.listTransfersByCharge,
      { sourceChargeId: chargeId },
    );
    expect(
      afterSuccessor.find((r) => r.stripeTransferId === legB)!
        .reversalClaimedAmount,
    ).toBe(299);

    const before = await snapshot(t, chargeId, operationId);

    await expect(
      reclaimReversalClaim(asStripe(stripe), component, ctx, {
        operationId,
        mode: "release",
        minAgeMs: DAY,
        now: Date.now() + 2 * DAY,
      }),
    ).rejects.toThrow(/claim frontier .* moved past/);

    // Byte-for-byte unchanged from right before the release attempt — leg A's
    // (valid) row was never patched either, proving the abort happens before
    // ANY leg is written, not just before the invalid one.
    const after = await snapshot(t, chargeId, operationId);
    expect(after).toEqual(before);
  });

  it("leg A valid + leg B missing from `verified` (mutations.ts ~534-539) — refuses, rewinds neither leg", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();
    const { chargeId, legA, operationId } = await seedMixedOp(
      stripe,
      t,
      ctx,
      component,
      "missing",
    );

    const before = await snapshot(t, chargeId, operationId);

    // Only reachable by calling the mutation directly: `reclaimReversalClaim`
    // always fetches live Stripe state for every unique leg in the op, so a
    // caller going through the public client can never omit one. Drive the
    // component mutation straight to prove the mutation itself still refuses
    // when handed an incomplete `verified` array (e.g. a buggy caller).
    await expect(
      t.mutation(api.connect.mutations.releaseReversalClaim, {
        operationId,
        verified: [{ stripeTransferId: legA, amountReversed: 0 }],
      }),
    ).rejects.toThrow(/missing live amount_reversed/);

    const after = await snapshot(t, chargeId, operationId);
    expect(after).toEqual(before);
  });

  it("leg A valid + leg B's money already moved (mutations.ts ~540-545) — refuses, rewinds neither leg", async () => {
    const t = convexTest(schema, modules);
    const ctx = makeCtx(t);
    const component = proxyComponent();
    const stripe = makeRacingStripe();
    const { chargeId, legB, operationId } = await seedMixedOp(
      stripe,
      t,
      ctx,
      component,
      "moved",
    );

    // Leg B's money actually moved out of band (mirrors the single-leg
    // BTS-74 "already moved" test above) — live amount_reversed now exceeds
    // this op's slice.from for leg B, while leg A is untouched and valid.
    await stripe.transfers.createReversal(
      legB,
      { amount: 50 },
      { idempotencyKey: "oob_mix_moved" },
    );
    expect(stripe.total(legB)).toBe(50);

    const before = await snapshot(t, chargeId, operationId);

    await expect(
      reclaimReversalClaim(asStripe(stripe), component, ctx, {
        operationId,
        mode: "release",
        minAgeMs: DAY,
        now: Date.now() + 2 * DAY,
      }),
    ).rejects.toThrow(/already moved/);

    const after = await snapshot(t, chargeId, operationId);
    expect(after).toEqual(before);
  });
});
