import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import type { Component, RunCtx } from "../helpers.js";
import { executeResolvedTransfers } from "./execution.js";
const TO_REF = Symbol.for("toReferencePath");
const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
const component = {
  settlement: {
    claims: {
      reserve: ref("settlement/mutations/reserveSettlementAllocation"),
    },
  },
  connect: {
    queries: {
      listTransfersByCharge: ref("connect/queries/listTransfersByCharge"),
    },
    mutations: { upsertTransfer: ref("connect/mutations/upsertTransfer") },
  },
} as unknown as Component;
it("recovers provider success after a ledger failure even without an idempotency cache", async () => {
  let claimed: unknown;
  const ledger: unknown[] = [],
    provider: Record<string, unknown>[] = [];
  let fail = true;
  const runMutation = vi.fn(
    async (r: Record<symbol, string>, args: Record<string, unknown>) => {
      if (r[TO_REF].endsWith("/reserveSettlementAllocation"))
        return claimed ?? (claimed = { ...args });
      if (
        r[TO_REF].includes("affiliateRecovery/") ||
        r[TO_REF].includes("affiliateEarnings/")
      )
        return undefined;
      if (fail) {
        fail = false;
        throw new Error("ledger unavailable");
      }
      ledger.push(args);
    },
  );
  const ctx = {
    runMutation,
    runQuery: vi.fn(async () => ledger),
  } as unknown as RunCtx;
  const raw = {
    charges: { retrieve: vi.fn().mockResolvedValue({ created: 1 }) },
    transfers: {
      list: vi.fn(async () => ({ data: provider, has_more: false })),
      create: vi.fn(async (args) => {
        const transfer = {
          id: `tr_${provider.length}`,
          destination: args.destination,
          ...args,
        };
        provider.push(transfer);
        return transfer;
      }),
    },
  };
  const opts = {
    sourceChargeId: "ch_1",
    gross: 100,
    currency: "usd",
    processingFee: 3,
    platformNet: 7,
    transfers: [
      { destinationAccountId: "acct_c", role: "store" as const, amount: 80 },
      {
        destinationAccountId: "acct_a",
        role: "affiliate" as const,
        amount: 10,
      },
    ],
  };
  await expect(
    executeResolvedTransfers(raw as unknown as Stripe, component, ctx, opts),
  ).rejects.toThrow("ledger unavailable");
  const result = await executeResolvedTransfers(
    raw as unknown as Stripe,
    component,
    ctx,
    {
      ...opts,
      platformNet: 17,
      transfers: [{ ...opts.transfers[0], amount: 70 }, opts.transfers[1]],
    },
  );
  expect(raw.transfers.create).toHaveBeenCalledTimes(2);
  expect(result.transfers.map((t) => t.amount)).toEqual([80, 10]);
  expect(ledger).toHaveLength(2);
  await executeResolvedTransfers(
    raw as unknown as Stripe,
    component,
    ctx,
    opts,
  );
  expect(raw.transfers.create).toHaveBeenCalledTimes(2);
});
it("recovers an orphaned original leg for refund/dispute clawback without creating more transfers", async () => {
  const { recoverSettlementTransfers } = await import("./reconciliation.js");
  const claim = {
    sourceChargeId: "ch_refund",
    gross: 100,
    currency: "usd",
    processingFee: 3,
    platformNet: 7,
    transfers: [
      { destinationAccountId: "acct_c", role: "store" as const, amount: 90 },
    ],
  };
  const provider = {
    id: "tr_orphan",
    destination: "acct_c",
    amount: 90,
    currency: "usd",
    source_transaction: "ch_refund",
    amount_reversed: 20,
    metadata: { bsSourceCharge: "ch_refund", bsRole: "store" },
  };
  const raw = {
    transfers: {
      list: vi.fn().mockResolvedValue({ data: [provider], has_more: false }),
      create: vi.fn(),
    },
  };
  const runMutation = vi.fn(),
    ctx = {
      runQuery: vi.fn().mockResolvedValue(claim),
      runMutation,
    } as unknown as RunCtx;
  await recoverSettlementTransfers(
    raw as unknown as Stripe,
    component,
    ctx,
    "ch_refund",
  );
  expect(runMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      stripeTransferId: "tr_orphan",
      sourceChargeId: "ch_refund",
      amount: 90,
      reversedAmount: 20,
    }),
  );
  expect(raw.transfers.create).not.toHaveBeenCalled();
});
it("finds legacy transfers without a transfer group before issuing a new request", async () => {
  const legacy = {
    id: "tr_legacy",
    destination: "acct_c",
    amount: 90,
    currency: "usd",
    source_transaction: "ch_old",
    metadata: { bsSourceCharge: "ch_old", bsRole: "store" },
  };
  const raw = {
    charges: { retrieve: vi.fn().mockResolvedValue({ created: 1 }) },
    transfers: {
      list: vi.fn(async (params: { transfer_group?: string }) => ({
        data: params.transfer_group ? [] : [legacy],
        has_more: false,
      })),
      create: vi.fn().mockResolvedValue({ id: "tr_duplicate" }),
    },
  };
  const opts = {
    sourceChargeId: "ch_old",
    gross: 100,
    currency: "usd",
    processingFee: 3,
    platformNet: 7,
    transfers: [
      { destinationAccountId: "acct_c", role: "store" as const, amount: 90 },
    ],
  };
  const ctx = {
    runQuery: vi.fn().mockResolvedValue([]),
    runMutation: vi.fn(async (r: Record<symbol, string>, args: unknown) =>
      r[TO_REF].endsWith("reserveSettlementAllocation") ? args : null,
    ),
  } as unknown as RunCtx;
  const result = await executeResolvedTransfers(
    raw as unknown as Stripe,
    component,
    ctx,
    opts,
  );
  expect(result.executedTransfers[0].stripeTransferId).toBe("tr_legacy");
  expect(raw.transfers.create).not.toHaveBeenCalled();
});
