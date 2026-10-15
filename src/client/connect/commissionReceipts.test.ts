import { reclaimReversalClaim } from "./transfers.js";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { findCommissionReversal } from "./commissionReceipts.js";
import { executeClaimedSlices } from "./reversalExecution.js";
import type { Component, RunCtx } from "../helpers.js";

const component = new Proxy(
  {},
  {
    get: (_t, p) =>
      p === Symbol.for("toReferencePath") ? "betterStripe" : component,
  },
) as Component;
const claim = {
  replay: false,
  slices: [
    {
      stripeTransferId: "tr_1",
      from: 0,
      to: 501,
      confirmed: 0,
      commissionTracked: true,
    },
  ],
};
const fixture = () => {
  const receipts: {
    id: string;
    amount: number;
    metadata: Record<string, string>;
  }[] = [];
  const stripe = {
    transfers: {
      createReversal: vi.fn(
        async (
          _id: string,
          params: { amount: number; metadata: Record<string, string> },
        ) => {
          const receipt = { id: "trr_1", ...params };
          receipts.push(receipt);
          return receipt;
        },
      ),
      listReversals: vi.fn(() =>
        (async function* () {
          yield* receipts;
        })(),
      ),
      retrieve: vi.fn(),
    },
  };
  const ctx = { runMutation: vi.fn().mockResolvedValue(null) };
  const run = (replay = false, confirmed = 0) =>
    executeClaimedSlices(
      stripe as unknown as Stripe,
      component,
      ctx as unknown as RunCtx,
      "re_1",
      { ...claim, replay, slices: [{ ...claim.slices[0], confirmed }] },
    );
  return { stripe, ctx, receipts, run };
};

describe("commission reversal receipt reconciliation", () => {
  it("recovers a provider success after the ledger confirmation crashed, even beyond the idempotency window", async () => {
    const f = fixture();
    f.ctx.runMutation.mockRejectedValueOnce(new Error("ledger offline"));
    await expect(f.run()).rejects.toThrow("ledger offline");
    expect(f.receipts).toHaveLength(1);
    await f.run(true);
    await f.run(true, 501);
    expect(f.stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(f.ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      stripeTransferId: "tr_1",
      reversedAmount: 501,
      receipt: { stripeReversalId: "trr_1", operationId: "re_1", amount: 501 },
    });
  });

  it("does not mistake another operation's aggregate reversal for this receipt", async () => {
    const f = fixture();
    f.receipts.push({
      id: "trr_other",
      amount: 501,
      metadata: { bsReversalOperation: "re_other" },
    });
    await expect(f.run(true, 501)).rejects.toThrow(
      "requires receipt reconciliation",
    );
    expect(f.stripe.transfers.retrieve).not.toHaveBeenCalled();
    expect(f.stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(f.ctx.runMutation).not.toHaveBeenCalled();
  });

  it("retries a failed provider attempt with byte-identical parameters and operation identity", async () => {
    const f = fixture();
    f.stripe.transfers.createReversal.mockRejectedValueOnce(
      new Error("network offline"),
    );
    await expect(f.run()).rejects.toThrow("network offline");
    await f.run(true);
    expect(f.stripe.transfers.createReversal.mock.calls[0]).toEqual(
      f.stripe.transfers.createReversal.mock.calls[1],
    );
    expect(f.receipts).toHaveLength(1);
  });

  it("rejects a mismatching receipt amount without confirming money", async () => {
    const f = fixture();
    f.receipts.push({
      id: "trr_bad",
      amount: 500,
      metadata: { bsReversalOperation: "re_1" },
    });
    await expect(f.run(true)).rejects.toThrow("amount mismatch");
    expect(f.ctx.runMutation).not.toHaveBeenCalled();
  });

  it("fails explicitly when the bounded receipt search cannot establish success", async () => {
    const f = fixture();
    for (let i = 0; i < 1001; i++)
      f.receipts.push({ id: `trr_${i}`, amount: 1, metadata: {} });
    await expect(
      findCommissionReversal(
        f.stripe as unknown as Stripe,
        "tr_1",
        "re_1",
        501,
      ),
    ).rejects.toThrow("lookup limit exceeded");
  });
});

it("operator re-execution delegates tracked commissions to the durable recovery engine", async () => {
  const f = fixture();
  const runQuery = vi
    .fn()
    .mockResolvedValueOnce({
      operationId: "re_1",
      sourceChargeId: "ch_1",
      _creationTime: 0,
      slices: [{ stripeTransferId: "tr_1", from: 0, to: 501 }],
      commissionExposure: { kind: "refund" },
    })
    .mockResolvedValueOnce({ role: "affiliate", reversedAmount: 0 });
  await reclaimReversalClaim(
    f.stripe as unknown as Stripe,
    component,
    { ...f.ctx, runQuery } as unknown as RunCtx,
    { operationId: "re_1" },
  );
  expect(f.stripe.transfers.createReversal).not.toHaveBeenCalled();
  expect(runQuery).toHaveBeenLastCalledWith(expect.anything(), {
    sourceChargeId: "ch_1",
  });
});
