import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { reverseTransfers } from "./transfers.js";

const TO_REF = Symbol.for("toReferencePath");

function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    connect: {
      queries: { listTransfersByCharge: ref("connect/queries/listTransfersByCharge") },
      mutations: {
        recordTransferReversal: ref("connect/mutations/recordTransferReversal"),
      },
    },
  } as unknown as Component;
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

function makeStripe() {
  return { transfers: { createReversal: vi.fn().mockResolvedValue({ id: "trr_1" }) } };
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
