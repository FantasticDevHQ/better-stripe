import { describe, expect, it, vi } from "vitest";

import { computeReversalSlices } from "../../component/lib/reversals.js";
import type { Component, RunCtx } from "../helpers.js";
import {
  createSplitTransfers,
  reinstateTransfers,
  reverseTransfers,
} from "./transfers.js";

const TO_REF = Symbol.for("toReferencePath");

function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    connect: {
      queries: { listTransfersByCharge: ref("connect/queries/listTransfersByCharge") },
      mutations: {
        recordTransferReversal: ref("connect/mutations/recordTransferReversal"),
        upsertTransfer: ref("connect/mutations/upsertTransfer"),
      },
    },
  } as unknown as Component;
}

function plainCtx() {
  return {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

/** ctx whose listTransfersByCharge returns the given ledger rows. */
function makeCtx(transfers: unknown[]) {
  const runQuery = vi.fn(async (refObj: Record<symbol, string>) => {
    const path = refObj[TO_REF].replace(/^betterStripe\//, "");
    if (path === "connect/queries/listTransfersByCharge") return transfers;
    return null;
  });
  // Fake claimReversalSlices' storage; the slice math is the real shared
  // computeReversalSlices over this ctx's ledger rows (BTS-63).
  const runMutation = vi.fn(
    async (refObj: Record<symbol, string>, args: Record<string, unknown>) => {
      const path = refObj[TO_REF].replace(/^betterStripe\//, "");
      if (path !== "connect/mutations/claimReversalSlices") return undefined;
      const legs = transfers as {
        stripeTransferId: string;
        amount: number;
        reversedAmount?: number;
        reversalClaimedAmount?: number;
      }[];
      const slices = computeReversalSlices(
        legs.map((t) => ({
          stripeTransferId: t.stripeTransferId,
          amount: t.amount,
          frontier: Math.max(t.reversedAmount ?? 0, t.reversalClaimedAmount ?? 0),
        })),
        args.mode as Parameters<typeof computeReversalSlices>[1],
      );
      return {
        replay: false,
        slices: slices.map((s) => ({
          ...s,
          confirmed:
            legs.find((t) => t.stripeTransferId === s.stripeTransferId)
              ?.reversedAmount ?? 0,
        })),
      };
    },
  );
  return {
    runQuery,
    runMutation,
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

let trSeq = 0;
function makeStripe() {
  return {
    transfers: {
      createReversal: vi.fn().mockResolvedValue({ id: "trr_1" }),
      create: vi.fn(async (_params: unknown) => ({ id: `tr_new_${++trSeq}` })),
    },
  };
}
const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof reverseTransfers>[0];

const TWO = [
  { stripeTransferId: "tr_store", amount: 8000 },
  { stripeTransferId: "tr_aff", amount: 1000 },
];

describe("reverseTransfers (BTS-25)", () => {
  it("fully reverses every transfer for a charge", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);

    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
    });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_store",
      { amount: 8000 },
      undefined,
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_aff",
      { amount: 1000 },
      undefined,
    );
    // ledger updated with cumulative reversed amounts
    const reversedAmounts = ctx.runMutation.mock.calls.map((c) => c[1].reversedAmount);
    expect(reversedAmounts).toEqual([8000, 1000]);
  });

  it("reverses a pro-rata percentage of each transfer", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);

    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      percent: 50,
    });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_store",
      { amount: 4000 },
      undefined,
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_aff",
      { amount: 500 },
      undefined,
    );
  });

  it("reverses a total amount pro-rata across recipients", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);

    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      amount: 4500, // of 9000 total → 4000 + 500
    });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_store",
      { amount: 4000 },
      undefined,
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_aff",
      { amount: 500 },
      undefined,
    );
  });

  it("is idempotent — skips an already fully-reversed transfer", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([
      { stripeTransferId: "tr_store", amount: 8000, reversedAmount: 8000 },
      { stripeTransferId: "tr_aff", amount: 1000 },
    ]);

    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
    });

    expect(stripe.transfers.createReversal).not.toHaveBeenCalledWith(
      "tr_store",
      { amount: 8000 },
      undefined,
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_aff",
      { amount: 1000 },
      undefined,
    );
  });

  it("rejects passing both percent and amount", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);
    await expect(
      reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
        sourceChargeId: "ch_1",
        percent: 50,
        amount: 100,
      }),
    ).rejects.toThrow();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range percent", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);
    await expect(
      reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
        sourceChargeId: "ch_1",
        percent: 150,
      }),
    ).rejects.toThrow();
  });

  it("never reverses more than the requested amount (rounding cap)", async () => {
    const stripe = makeStripe();
    // Two 1-cent transfers; reverse a total of 1 cent. Independent rounding would
    // reverse 2; the remainder cap must keep the total at 1.
    const ctx = makeCtx([
      { stripeTransferId: "tr_a", amount: 1 },
      { stripeTransferId: "tr_b", amount: 1 },
    ]);
    const res = await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      amount: 1,
    });
    const total = res.reversals.reduce((s, r) => s + r.amount, 0);
    // Exactly the requested 1 cent — never more (cap), never under-allocated to 0.
    expect(total).toBe(1);
  });

  it("passes a stable idempotency key when operationId is given", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([{ stripeTransferId: "tr_store", amount: 8000 }]);
    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      operationId: "dp_1",
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_store",
      { amount: 8000 },
      { idempotencyKey: "bs_rev_dp_1_tr_store" },
    );
  });
});

describe("computeReversalSlices amount-mode exact total (BTS-102)", () => {
  // All legs fresh (frontier 0). The audit finding: per-leg rounding drops
  // residue when every leg's pro-rata share rounds down, so the reclaimed sum
  // falls short of the requested amount. The fix must reclaim EXACTLY
  // min(amount, total headroom) for any leg-count/amount combination — never
  // more (the budget cap), never short (residue redistributed).
  const asLegs = (amounts: number[]) =>
    amounts.map((amount, i) => ({
      stripeTransferId: `tr_${i}`,
      amount,
      frontier: 0,
    }));
  const reversed = (slices: { from: number; to: number }[]) =>
    slices.reduce((s, sl) => s + (sl.to - sl.from), 0);

  const cases: { split: number[]; amount: number }[] = [
    { split: [33, 33, 34], amount: 10 }, // audit counter-example: rounds 3+3+3=9
    { split: [33, 33, 34], amount: 100 }, // the whole charge
    { split: [1, 1, 1], amount: 1 }, // every share rounds to 0
    { split: [1, 1, 1], amount: 2 },
    { split: [7000, 1000, 1000], amount: 3333 },
    { split: [100, 300], amount: 398 }, // BTS-79 shape
    { split: [1, 1_000_000], amount: 500_000 },
    { split: [10, 10, 10, 10, 10, 10, 10], amount: 33 },
    { split: [10, 10], amount: 100 }, // amount exceeds total headroom
  ];

  it.each(cases)(
    "reverses exactly min(amount, total) for split $split, amount $amount",
    ({ split, amount }) => {
      const total = split.reduce((a, b) => a + b, 0);
      const slices = computeReversalSlices(asLegs(split), {
        kind: "amount",
        amount,
      });
      // The full requested amount is clawed back (capped at total headroom):
      // residue is redistributed, not dropped.
      expect(reversed(slices)).toBe(Math.min(amount, total));
      // ...and never MORE than requested — the "sum exceeds amount" cap holds.
      expect(reversed(slices)).toBeLessThanOrEqual(amount);
      // Every slice stays a real, in-bounds interval on its leg.
      for (const sl of slices) {
        const leg = split[Number(sl.stripeTransferId.slice(3))]!;
        expect(sl.to).toBeGreaterThan(sl.from);
        expect(sl.to).toBeLessThanOrEqual(leg);
      }
    },
  );

  it("the 33/33/34 → 10 counter-example is no longer short by a cent", () => {
    const slices = computeReversalSlices(asLegs([33, 33, 34]), {
      kind: "amount",
      amount: 10,
    });
    expect(reversed(slices)).toBe(10);
  });
});

describe("createSplitTransfers engine (BTS-22)", () => {
  it("creates a transfer per recipient with source_transaction + ledger row (2-way)", async () => {
    const stripe = makeStripe();
    const ctx = plainCtx();

    const result = await createSplitTransfers(
      asStripe(stripe),
      makeComponent(),
      ctx,
      {
        sourceChargeId: "ch_1",
        amount: 10000,
        currency: "usd",
        feeConfig: { percent: 10 },
        paymentId: "pi_1",
        split: [
          { destinationAccountId: "acct_store", role: "store", percent: 80 },
          { destinationAccountId: "acct_aff", role: "affiliate", percent: 5 },
        ],
      },
    );

    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    const first = stripe.transfers.create.mock.calls[0][0];
    expect(first).toMatchObject({
      amount: 8000,
      currency: "usd",
      destination: "acct_store",
      source_transaction: "ch_1",
    });
    expect(stripe.transfers.create.mock.calls[1][0]).toMatchObject({
      amount: 500,
      destination: "acct_aff",
    });
    // ledger rows
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({
      sourceChargeId: "ch_1",
      destinationAccountId: "acct_store",
      amount: 8000,
      role: "store",
      status: "paid",
      paymentId: "pi_1",
    });
    // platform keeps the remainder; non-negative
    expect(result.platformRetained).toBe(1500);
    expect(result.platformRetained).toBeGreaterThanOrEqual(0);
  });

  it("handles a 3-way split", async () => {
    const stripe = makeStripe();
    const ctx = plainCtx();

    await createSplitTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_2",
      amount: 10000,
      currency: "usd",
      split: [
        { destinationAccountId: "a", role: "store", amount: 7000 },
        { destinationAccountId: "b", role: "affiliate", amount: 1000 },
        { destinationAccountId: "c", role: "other", amount: 1000 },
      ],
    });

    expect(stripe.transfers.create).toHaveBeenCalledTimes(3);
    expect(ctx.runMutation).toHaveBeenCalledTimes(3);
  });

  it("skips zero-amount transfers", async () => {
    const stripe = makeStripe();
    const ctx = plainCtx();

    await createSplitTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_3",
      amount: 10000,
      currency: "usd",
      split: [
        { destinationAccountId: "a", role: "store", amount: 9000 },
        { destinationAccountId: "b", role: "affiliate", amount: 0 },
      ],
    });

    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });
});

describe("createSplitTransfers idempotency (BTS-24)", () => {
  it("skips recipients already recorded in the ledger (partial-failure recovery)", async () => {
    const stripe = makeStripe();
    // The store transfer already exists from a prior (partial) run.
    const ctx = makeCtx([
      { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000 },
    ]);

    await createSplitTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      amount: 10000,
      currency: "usd",
      split: [
        { destinationAccountId: "acct_store", role: "store", amount: 8000 },
        { destinationAccountId: "acct_aff", role: "affiliate", amount: 1000 },
      ],
    });

    // Only the affiliate transfer is created the second time.
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][0]).toMatchObject({
      destination: "acct_aff",
    });
  });

  it("creates nothing when all recipients are already in the ledger (full replay)", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([
      { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000 },
      { stripeTransferId: "tr_aff", destinationAccountId: "acct_aff", role: "affiliate", amount: 1000 },
    ]);

    await createSplitTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      amount: 10000,
      currency: "usd",
      split: [
        { destinationAccountId: "acct_store", role: "store", amount: 8000 },
        { destinationAccountId: "acct_aff", role: "affiliate", amount: 1000 },
      ],
    });

    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("reinstateTransfers (BTS-29)", () => {
  it("re-creates transfers for the reversed amounts (dispute won)", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([
      { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000, currency: "usd", reversedAmount: 8000 },
      { stripeTransferId: "tr_aff", destinationAccountId: "acct_aff", role: "affiliate", amount: 1000, currency: "usd", reversedAmount: 1000 },
    ]);

    await reinstateTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      operationId: "dp_1",
      currency: "usd",
    });

    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, currency: "usd", destination: "acct_store" }),
      { idempotencyKey: "bs_reinstate_dp_1_acct_store_store" },
    );
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, destination: "acct_aff" }),
      { idempotencyKey: "bs_reinstate_dp_1_acct_aff_affiliate" },
    );
    // Ledger rows are tagged reinstatement so they stay out of the charge's
    // split-leg view and can't be re-reversed.
    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({ reinstatement: true });
  });

  it("uses a legacy row's fallback currency from the dispute, not USD", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([
      // Legacy row with no stored currency.
      { stripeTransferId: "tr_x", destinationAccountId: "acct_x", role: "store", amount: 5000, reversedAmount: 5000 },
    ]);
    await reinstateTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      operationId: "dp_1",
      currency: "eur",
    });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "eur" }),
      expect.anything(),
    );
  });

  it("skips transfers that were never reversed", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx([
      { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000, currency: "usd" },
    ]);
    await reinstateTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      operationId: "dp_1",
      currency: "usd",
    });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});
