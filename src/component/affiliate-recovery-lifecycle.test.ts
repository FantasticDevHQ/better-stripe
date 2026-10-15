// @vitest-environment edge-runtime
import type Stripe from "stripe";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import type { Component, RunCtx } from "../client/helpers.js";
import {
  reverseTransfers,
  reclaimReversalClaim,
  reverseTransfersForRefund,
  reverseTransfersForDispute,
} from "../client/connect/transfers.js";
import { executeResolvedTransfers } from "../client/settlement/execution.js";
import { reconcileObligation } from "../client/affiliateRecovery/engine.js";
const modules = import.meta.glob("./**/*.*s");
const REF = Symbol.for("toReferencePath");
function component(path = "betterStripe"): Component {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        key === REF
          ? path
          : typeof key === "string"
            ? component(`${path}/${key}`)
            : undefined,
    },
  ) as Component;
}
const list = <T>(values: T[]) => ({
  then: <R>(resolve: (v: { data: T[]; has_more: boolean }) => R) =>
    Promise.resolve(resolve({ data: values, has_more: false })),
  async *[Symbol.asyncIterator]() {
    yield* values;
  },
});
async function setup() {
  const t = convexTest(schema, modules);
  const route = (ref: unknown) =>
    (ref as Record<symbol, string>)[REF].replace("betterStripe/", "")
      .split("/")
      .reduce(
        (node, key) => (node as Record<string, unknown>)[key],
        api as unknown,
      );
  const query = t.query as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  const mutation = t.mutation as unknown as (
    ref: unknown,
    args: unknown,
  ) => Promise<unknown>;
  const ctx = {
    runQuery: (ref: unknown, args: unknown) => query(route(ref), args),
    runMutation: (ref: unknown, args: unknown) => mutation(route(ref), args),
  } as unknown as RunCtx;
  type Transfer = {
    id: string;
    amount: number;
    currency: string;
    destination: string;
    source_transaction?: string;
    transfer_group?: string;
    amount_reversed: number;
    metadata: Record<string, string>;
  };
  const transfers: Transfer[] = [],
    receipts: {
      id: string;
      amount: number;
      transfer: string;
      metadata: Record<string, string>;
    }[] = [];
  let restoreInsufficient = false,
    restoreTimeout = false;
  let insufficient = false,
    timeout = false,
    enabled = true;
  const keys = new Map<string, unknown>();
  const provider = {
    v2: {
      core: {
        accounts: {
          retrieve: async () => ({
            configuration: {
              recipient: {
                capabilities: {
                  stripe_balance: {
                    stripe_transfers: {
                      status: enabled ? "active" : "restricted",
                    },
                  },
                },
              },
            },
          }),
        },
      },
    },
    charges: { retrieve: async () => ({ amount: 10000, created: 1 }) },
    transfers: {
      list: (args: { transfer_group?: string }) =>
        list(
          transfers.filter(
            (r) =>
              !args.transfer_group || r.transfer_group === args.transfer_group,
          ),
        ),
      retrieve: async (id: string) => {
        const row = transfers.find((r) => r.id === id);
        if (!row) throw new Error("Unknown transfer");
        return row;
      },
      listReversals: (id: string) =>
        list(receipts.filter((r) => r.transfer === id)),
      create: async (
        args: Omit<Transfer, "id" | "amount_reversed">,
        opts: { idempotencyKey: string },
      ) => {
        if (keys.has(opts.idempotencyKey)) return keys.get(opts.idempotencyKey);
        if (restoreInsufficient && args.metadata?.bsRecoveryOperation)
          throw {
            type: "StripeInvalidRequestError",
            code: "balance_insufficient",
            message: "Platform restoration funds unavailable.",
          };
        const row = {
          ...args,
          id: `tr_${transfers.length + 1}`,
          amount_reversed: 0,
        };
        transfers.push(row);
        keys.set(opts.idempotencyKey, row);
        if (restoreTimeout && args.metadata?.bsRecoveryOperation) {
          restoreTimeout = false;
          throw {
            type: "StripeConnectionError",
            message: "Restoration timeout after success.",
          };
        }
        return row;
      },
      createReversal: async (
        id: string,
        args: { amount: number; metadata: Record<string, string> },
        opts: { idempotencyKey: string },
      ) => {
        if (keys.has(opts.idempotencyKey)) return keys.get(opts.idempotencyKey);
        if (insufficient)
          throw {
            type: "StripeInvalidRequestError",
            code: "balance_insufficient",
            message: "Insufficient connected balance after external payout.",
          };
        const transfer = transfers.find((r) => r.id === id)!;
        if (args.amount > transfer.amount - transfer.amount_reversed)
          throw new Error("Excess reversal");
        transfer.amount_reversed += args.amount;
        const receipt = {
          ...args,
          transfer: id,
          id: `trr_${receipts.length + 1}`,
        };
        receipts.push(receipt);
        keys.set(opts.idempotencyKey, receipt);
        if (timeout) {
          timeout = false;
          throw {
            type: "StripeConnectionError",
            message: "Timeout after success.",
          };
        }
        return receipt;
      },
    },
  };
  const stripe = provider as unknown as Stripe,
    comp = component();
  const settle = (charge: string, commission = 1001, currency = "usd") =>
    executeResolvedTransfers(stripe, comp, ctx, {
      sourceChargeId: charge,
      sourceInvoiceId: `in_${charge}`,
      paymentIntentId: `pi_${charge}`,
      gross: 10000,
      currency,
      processingFee: 0,
      platformNet: 10000 - commission,
      transfers: [
        {
          destinationAccountId: "acct_a",
          amount: commission,
          role: "affiliate",
        },
      ],
    });
  const refund = (charge: string, principal = 10000) =>
    reverseTransfersForRefund(stripe, comp, ctx, {
      sourceChargeId: charge,
      chargeAmount: 10000,
      refundId: `re_${charge}_${principal}`,
      amountRefunded: principal,
    });
  const dispute = (
    charge: string,
    state: "open" | "won" | "lost",
    refundedPrincipal = 0,
    amount = 10000,
  ) =>
    reverseTransfersForDispute(stripe, comp, ctx, {
      sourceChargeId: charge,
      chargeAmount: 10000,
      operationId: `dp_${charge}`,
      amount,
      finalized: state === "lost",
      disputeState: state,
      refundedPrincipal,
    });
  const snapshot = (currency = "usd") =>
    t.query(api.affiliateRecovery.queries.recoverySnapshot, {
      affiliateAccountId: "acct_a",
      currency,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return {
    t,
    ctx,
    stripe,
    comp,
    transfers,
    receipts,
    settle,
    refund,
    dispute,
    snapshot,
    failRestoration: () => {
      restoreInsufficient = true;
    },
    allowRestoration: () => {
      restoreInsufficient = false;
    },
    timeoutRestoration: () => {
      restoreTimeout = true;
    },
    failBalance: () => {
      insufficient = true;
    },
    allowBalance: () => {
      insufficient = false;
    },
    timeout: () => {
      timeout = true;
    },
    disable: () => {
      enabled = false;
    },
  };
}
describe("affiliate recovery lifecycle", () => {
  it("recovers the exact original commission and records a receipt once", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.refund("ch_1", 5000);
    await f.refund("ch_1", 5000);
    expect(f.receipts.map((r) => r.amount)).toEqual([501]);
    expect(
      await f.t.query(api.connect.queries.getAccountEarningsByCurrency, {
        destinationAccountId: "acct_a",
      }),
    ).toMatchObject({
      totals: [{ currency: "usd", gross: 1001, reversed: 501, net: 500 }],
    });
    expect((await f.snapshot()).balance).toMatchObject({
      recoveredAmount: 501,
      outstandingDebt: 0,
      reservedRecovery: 0,
    });
  });
  it("carries paid-out debt forward and atomically offsets future commissions in the same currency", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.failBalance();
    await f.refund("ch_1");
    expect((await f.snapshot()).balance).toMatchObject({
      outstandingDebt: 1001,
      recoveredAmount: 0,
    });
    await f.settle("ch_jpy", 700, "jpy");
    expect((await f.snapshot()).balance!.outstandingDebt).toBe(1001);
    await Promise.all([f.settle("ch_2", 700), f.settle("ch_3", 700)]);
    const result = await f.snapshot();
    expect(result.balance).toMatchObject({
      outstandingDebt: 0,
      offsetAmount: 1001,
      withheldAmount: 1001,
      netPayable: 0,
    });
    expect(
      f.transfers
        .filter((r) => ["ch_2", "ch_3"].includes(r.source_transaction ?? ""))
        .reduce((s, r) => s + r.amount, 0),
    ).toBe(399);
    f.allowBalance();
    await reconcileObligation(
      f.stripe,
      f.comp,
      f.ctx,
      result.obligations.page.find((r) => r.sourceChargeId === "ch_1")!._id,
    );
    expect(f.receipts).toHaveLength(0);
  });
  it("preserves a fully withheld invoice commission when that invoice is refunded", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.failBalance();
    await f.refund("ch_1");
    await f.settle("ch_2", 700);
    await f.refund("ch_2");
    expect((await f.snapshot()).balance).toMatchObject({
      outstandingDebt: 1001,
      offsetAmount: 700,
    });
    expect(f.transfers.some((r) => r.source_transaction === "ch_2")).toBe(
      false,
    );
    expect(
      (await f.snapshot()).obligations.page.find(
        (r) => r.sourceChargeId === "ch_2",
      ),
    ).toMatchObject({
      originalCommission: 700,
      releasedCommission: 0,
      finalizedAmount: 700,
      debtAmount: 700,
    });
  });
  it("blocks release on an unknown outcome and reconciles provider success without duplicate recovery", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.timeout();
    await f.refund("ch_1");
    expect((await f.snapshot()).balance!.reservedRecovery).toBe(1001);
    await expect(f.settle("ch_2", 700)).rejects.toThrow(
      "pending reconciliation",
    );
    await f.refund("ch_1");
    await f.settle("ch_2", 700);
    expect(f.receipts).toHaveLength(1);
    expect((await f.snapshot()).balance).toMatchObject({
      outstandingDebt: 0,
      reservedRecovery: 0,
      recoveredAmount: 1001,
      offsetAmount: 0,
    });
  });
  it.each([true, false])(
    "retains independent refunds on a dispute win (refund first %s)",
    async (first) => {
      const f = await setup();
      await f.settle("ch_1");
      if (first) await f.refund("ch_1", 5000);
      await f.dispute("ch_1", "open");
      if (!first) await f.refund("ch_1", 5000);
      await f.dispute("ch_1", "won", 5000);
      await f.dispute("ch_1", "won", 5000);
      await f.dispute("ch_1", "open", 5000);
      expect((await f.snapshot()).balance).toMatchObject({
        recoveredAmount: 1001,
        restoredAmount: 500,
        outstandingDebt: 0,
        restorationDue: 0,
      });
      expect(
        f.transfers
          .filter((r) => r.metadata.bsRecoveryOperation)
          .map((r) => r.amount),
      ).toEqual([500]);
      expect(
        await f.t.query(api.connect.queries.getAccountEarningsByCurrency, {
          destinationAccountId: "acct_a",
        }),
      ).toMatchObject({
        totals: [{ currency: "usd", gross: 1501, reversed: 1001, net: 500 }],
      });
      expect((await f.snapshot()).obligations.page[0]).toMatchObject({
        disputeState: "won",
        finalizedAmount: 501,
        provisionalAmount: 0,
      });
    },
  );
  it("finalizes a partial lost dispute without another debit", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.dispute("ch_1", "open", 0, 2500);
    await f.dispute("ch_1", "lost", 0, 2500);
    await f.dispute("ch_1", "open", 0, 2500);
    expect(f.receipts.map((r) => r.amount)).toEqual([250]);
    expect((await f.snapshot()).obligations.page[0]).toMatchObject({
      finalizedAmount: 250,
      provisionalAmount: 0,
    });
  });
  it("cancels unrecovered debt and restores only actual offsets on a win", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.failBalance();
    await f.dispute("ch_1", "open");
    await f.settle("ch_2", 400);
    await f.dispute("ch_1", "won");
    expect((await f.snapshot()).balance).toMatchObject({
      outstandingDebt: 0,
      offsetAmount: 400,
      restoredAmount: 400,
      recoveredAmount: 0,
    });
  });
  it("surfaces unsupported Connect paths and preserves debt for operator action", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.disable();
    await f.refund("ch_1");
    expect((await f.snapshot()).obligations.page[0]).toMatchObject({
      lastState: "unsupported",
      debtAmount: 1001,
    });
    expect(f.receipts).toHaveLength(0);
  });
  it("coordinates affiliate payout minimums, debt, unknown reservations and concurrent release", async () => {
    const f = await setup();
    await f.settle("ch_1");
    const args = {
      affiliateAccountId: "acct_a",
      currency: "usd",
      amount: 501,
      minimumAmount: 500,
      operationKey: "po_1",
      now: 1,
    };
    await expect(
      f.t.mutation(api.affiliatePayouts.mutations.reservePayout, {
        ...args,
        amount: 499,
      }),
    ).rejects.toThrow("minimum");
    await f.t.mutation(api.affiliatePayouts.mutations.reservePayout, args);
    await expect(
      f.t.mutation(api.affiliatePayouts.mutations.reservePayout, {
        ...args,
        operationKey: "po_2",
      }),
    ).rejects.toThrow("before payout release");
    await expect(f.settle("ch_2", 700)).rejects.toThrow("payout is pending");
    await f.t.mutation(api.affiliatePayouts.mutations.finishPayout, {
      operationKey: "po_1",
      state: "unknown",
    });
    expect((await f.snapshot()).balance!.activePayoutKey).toBe("po_1");
    await f.t.mutation(api.affiliatePayouts.mutations.finishPayout, {
      operationKey: "po_1",
      state: "submitted",
      stripePayoutId: "po_receipt",
    });
    await f.settle("ch_2", 700);
    f.failBalance();
    await f.refund("ch_1");
    await expect(
      f.t.mutation(api.affiliatePayouts.mutations.reservePayout, {
        ...args,
        operationKey: "po_3",
      }),
    ).rejects.toThrow("before payout release");
  });
  it("keeps failed restoration visible until a provider receipt confirms payment", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.dispute("ch_1", "open");
    f.failRestoration();
    await f.dispute("ch_1", "won");
    expect((await f.snapshot()).balance).toMatchObject({
      restoredAmount: 0,
      restorationDue: 1001,
      reservedRestoration: 0,
    });
    f.allowRestoration();
    await reconcileObligation(
      f.stripe,
      f.comp,
      f.ctx,
      (await f.snapshot()).obligations.page[0]._id,
    );
    expect((await f.snapshot()).balance).toMatchObject({
      restoredAmount: 1001,
      restorationDue: 0,
    });
  });
  it("reconciles a restoration timeout without paying twice", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.dispute("ch_1", "open");
    f.timeoutRestoration();
    await f.dispute("ch_1", "won");
    expect((await f.snapshot()).balance).toMatchObject({
      restoredAmount: 0,
      reservedRestoration: 1001,
    });
    await expect(f.settle("ch_2", 400)).rejects.toThrow(
      "pending reconciliation",
    );
    await reconcileObligation(
      f.stripe,
      f.comp,
      f.ctx,
      (await f.snapshot()).obligations.page[0]._id,
    );
    expect((await f.snapshot()).balance).toMatchObject({
      restoredAmount: 1001,
      reservedRestoration: 0,
    });
    expect(
      f.transfers.filter((r) => r.metadata.bsRecoveryOperation),
    ).toHaveLength(1);
  });
  it("handles terminal events first and offsets a refund after full restoration", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.dispute("ch_1", "won");
    await f.dispute("ch_1", "open");
    expect(f.receipts).toHaveLength(0);
    const g = await setup();
    await g.settle("ch_1");
    await g.dispute("ch_1", "open");
    await g.dispute("ch_1", "won");
    await g.refund("ch_1", 5000);
    expect((await g.snapshot()).balance!.outstandingDebt).toBe(501);
    await g.settle("ch_2", 700);
    expect((await g.snapshot()).balance).toMatchObject({
      outstandingDebt: 0,
      offsetAmount: 501,
      restoredAmount: 1001,
    });
    expect(g.receipts).toHaveLength(1);
  });
  it("prevents legacy reversal utilities from bypassing already-applied offsets", async () => {
    const f = await setup();
    await f.settle("ch_1");
    await f.t.mutation(api.connect.mutations.claimReversalSlices, {
      sourceChargeId: "ch_1",
      operationId: "legacy_op",
      mode: { kind: "full" },
    });
    await reclaimReversalClaim(f.stripe, f.comp, f.ctx, {
      operationId: "legacy_op",
    });
    f.failBalance();
    await f.refund("ch_1");
    await f.settle("ch_2", 1001);
    await reclaimReversalClaim(f.stripe, f.comp, f.ctx, {
      operationId: "legacy_op",
    });
    expect((await f.snapshot()).balance!.offsetAmount).toBe(1001);
    await expect(
      reverseTransfers(f.stripe, f.comp, f.ctx, { sourceChargeId: "ch_1" }),
    ).rejects.toThrow("affiliateRecovery.retry");
    expect(f.receipts).toHaveLength(0);
  });
  it("does not treat an unattributed reversal aggregate as permission to collect again", async () => {
    const f = await setup();
    await f.settle("ch_1");
    f.timeout();
    await f.refund("ch_1");
    f.receipts[0].metadata = {};
    await f.refund("ch_1");
    expect(f.receipts).toHaveLength(1);
    expect((await f.snapshot()).balance).toMatchObject({
      recoveredAmount: 0,
      reservedRecovery: 1001,
    });
    await expect(f.settle("ch_2", 400)).rejects.toThrow(
      "pending reconciliation",
    );
    expect((await f.snapshot()).obligations.page[0].lastError).toContain(
      "attributable operation receipt",
    );
  });
});
