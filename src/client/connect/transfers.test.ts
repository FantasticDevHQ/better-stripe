import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { createSplitTransfers, reverseTransfers } from "./transfers.js";

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
  return {
    runQuery,
    runMutation: vi.fn().mockResolvedValue(undefined),
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

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_store", {
      amount: 8000,
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_aff", {
      amount: 1000,
    });
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

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_store", {
      amount: 4000,
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_aff", {
      amount: 500,
    });
  });

  it("reverses a total amount pro-rata across recipients", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx(TWO);

    await reverseTransfers(asStripe(stripe), makeComponent(), ctx, {
      sourceChargeId: "ch_1",
      amount: 4500, // of 9000 total → 4000 + 500
    });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_store", {
      amount: 4000,
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_aff", {
      amount: 500,
    });
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

    expect(stripe.transfers.createReversal).not.toHaveBeenCalledWith("tr_store", {
      amount: 8000,
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_aff", {
      amount: 1000,
    });
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
