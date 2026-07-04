// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("transfers ledger (BTS-12)", () => {
  it("upserts a transfer and reads it back by stripe id", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_1",
      sourceChargeId: "ch_1",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
      paymentId: "pi_1",
    });

    const tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_1",
    });
    expect(tr).not.toBeNull();
    expect(tr!.amount).toBe(8000);
    expect(tr!.destinationAccountId).toBe("acct_store");
    expect(tr!.role).toBe("store");
    expect(tr!.status).toBe("paid");
  });

  it("upsert updates an existing transfer by stripe id", async () => {
    const t = convexTest(schema, modules);
    const base = {
      stripeTransferId: "tr_2",
      destinationAccountId: "acct_x",
      amount: 5000,
      currency: "usd",
      status: "pending" as const,
    };
    await t.mutation(api.connect.mutations.upsertTransfer, base);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      ...base,
      status: "paid",
    });

    const tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_2",
    });
    expect(tr!.status).toBe("paid");
  });

  it("records a partial then full reversal and denormalizes reversalStatus", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_3",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      status: "paid",
    });

    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_3",
      reversedAmount: 4000,
    });
    let tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_3",
    });
    expect(tr!.reversedAmount).toBe(4000);
    expect(tr!.reversalStatus).toBe("partially_reversed");

    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_3",
      reversedAmount: 8000,
    });
    tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_3",
    });
    expect(tr!.reversedAmount).toBe(8000);
    expect(tr!.reversalStatus).toBe("fully_reversed");
  });

  it("lists transfers by source charge and by destination account", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_store",
      sourceChargeId: "ch_split",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
    });
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_aff",
      sourceChargeId: "ch_split",
      destinationAccountId: "acct_aff",
      amount: 1000,
      currency: "usd",
      role: "affiliate",
      status: "paid",
    });
    // Control row from a different charge — must be excluded by both filters.
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_other",
      sourceChargeId: "ch_other",
      destinationAccountId: "acct_other",
      amount: 500,
      currency: "usd",
      role: "other",
      status: "paid",
    });

    const byCharge = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_split",
    });
    expect(byCharge).toHaveLength(2);
    expect(byCharge.map((tr) => tr.stripeTransferId).sort()).toEqual([
      "tr_aff",
      "tr_store",
    ]);

    const byAccount = await t.query(
      api.connect.queries.listTransfersByAccount,
      { destinationAccountId: "acct_store" },
    );
    expect(byAccount).toHaveLength(1);
    expect(byAccount[0].stripeTransferId).toBe("tr_store");
  });

  it("excludes reinstatement rows from listTransfersByCharge (BTS-29 audit-only)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_orig",
      sourceChargeId: "ch_d",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
    });
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_reinstate",
      sourceChargeId: "ch_d",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
      reinstatement: true,
    });

    // The charge's split-leg view returns only the original transfer.
    const byCharge = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_d",
    });
    expect(byCharge.map((tr) => tr.stripeTransferId)).toEqual(["tr_orig"]);
    // But both are visible in the account's earnings view.
    const byAccount = await t.query(
      api.connect.queries.listTransfersByAccount,
      { destinationAccountId: "acct_store" },
    );
    expect(byAccount).toHaveLength(2);
  });

  it("keeps reversal state monotonic across stale events and re-upserts", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_mono",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      status: "paid",
    });

    // Fully reverse.
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_mono",
      reversedAmount: 8000,
    });
    // A stale/out-of-order reversal event with a smaller total must not shrink it.
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_mono",
      reversedAmount: 4000,
    });
    let tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_mono",
    });
    expect(tr!.reversedAmount).toBe(8000);
    expect(tr!.reversalStatus).toBe("fully_reversed");
    expect(tr!.status).toBe("reversed");

    // A re-delivered base upsert (status "paid") must not flip it back.
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_mono",
      destinationAccountId: "acct_store",
      amount: 8000,
      currency: "usd",
      status: "paid",
    });
    tr = await t.query(api.connect.queries.getTransferByStripeId, {
      stripeTransferId: "tr_mono",
    });
    expect(tr!.reversedAmount).toBe(8000);
    expect(tr!.reversalStatus).toBe("fully_reversed");
    expect(tr!.status).toBe("reversed");
  });
});

describe("claimReversalSlices (BTS-63)", () => {
  const seed = async (
    t: ReturnType<typeof convexTest>,
    args: {
      stripeTransferId: string;
      amount: number;
      reversedAmount?: number;
      reinstatement?: boolean;
    },
  ) => {
    await t.mutation(api.connect.mutations.upsertTransfer, {
      sourceChargeId: "ch_claim",
      destinationAccountId: "acct_x",
      currency: "usd",
      role: "store",
      status: "paid",
      ...args,
    });
  };

  it("claims a fraction slice atomically and advances the claim frontier", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { stripeTransferId: "tr_c1", amount: 7000 });

    const claim = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_1",
      sourceChargeId: "ch_claim",
      mode: { kind: "fraction", chargeAmount: 10000, amountRefunded: 4000 },
    });

    expect(claim).toEqual({
      replay: false,
      slices: [{ stripeTransferId: "tr_c1", from: 0, to: 2800, confirmed: 0 }],
    });

    // A DIFFERENT operation claiming the same target before the first one
    // confirms gets nothing — the frontier, not the confirmed amount, gates
    // new claims (this is what closes the concurrent-distinct-refunds race).
    const rival = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_2",
      sourceChargeId: "ch_claim",
      mode: { kind: "fraction", chargeAmount: 10000, amountRefunded: 4000 },
    });
    expect(rival).toEqual({ replay: false, slices: [] });
  });

  it("replays an operation's recorded slices verbatim even after the ledger moves", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { stripeTransferId: "tr_c2", amount: 8000 });

    const first = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_9",
      sourceChargeId: "ch_claim",
      mode: { kind: "amount", amount: 4000 },
    });
    expect(first.slices).toEqual([
      { stripeTransferId: "tr_c2", from: 0, to: 4000, confirmed: 0 },
    ]);

    // The ledger moves between deliveries (another operation confirms more).
    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_c2",
      reversedAmount: 6000,
    });

    // The redelivery gets the ORIGINAL slice back (byte-identical replay),
    // with the live confirmed amount so the executor can skip it.
    const retry = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_9",
      sourceChargeId: "ch_claim",
      mode: { kind: "amount", amount: 4000 },
    });
    expect(retry).toEqual({
      replay: true,
      slices: [
        { stripeTransferId: "tr_c2", from: 0, to: 4000, confirmed: 6000 },
      ],
    });
  });

  it("claims percent slices across split legs and replays the recorded claim", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { stripeTransferId: "tr_pct_store", amount: 7000 });
    await seed(t, { stripeTransferId: "tr_pct_aff", amount: 3000 });

    const first = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_percent",
      sourceChargeId: "ch_claim",
      mode: { kind: "percent", percent: 33 },
    });

    expect(first).toEqual({
      replay: false,
      slices: [
        { stripeTransferId: "tr_pct_store", from: 0, to: 2310, confirmed: 0 },
        { stripeTransferId: "tr_pct_aff", from: 0, to: 990, confirmed: 0 },
      ],
    });

    await t.mutation(api.connect.mutations.recordTransferReversal, {
      stripeTransferId: "tr_pct_store",
      reversedAmount: 2500,
    });

    const retry = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_percent",
      sourceChargeId: "ch_claim",
      mode: { kind: "percent", percent: 33 },
    });
    expect(retry).toEqual({
      replay: true,
      slices: [
        {
          stripeTransferId: "tr_pct_store",
          from: 0,
          to: 2310,
          confirmed: 2500,
        },
        { stripeTransferId: "tr_pct_aff", from: 0, to: 990, confirmed: 0 },
      ],
    });
  });

  it("records an empty claim so a redelivery stays a no-op as state changes", async () => {
    const t = convexTest(schema, modules);
    await seed(t, {
      stripeTransferId: "tr_c3",
      amount: 5000,
      reversedAmount: 5000,
    });

    const first = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_empty",
      sourceChargeId: "ch_claim",
      mode: { kind: "full" },
    });
    expect(first).toEqual({ replay: false, slices: [] });

    const retry = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_empty",
      sourceChargeId: "ch_claim",
      mode: { kind: "full" },
    });
    expect(retry).toEqual({ replay: true, slices: [] });
  });

  it("never claims against reinstatement payout rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t, {
      stripeTransferId: "tr_c4",
      amount: 3000,
      reversedAmount: 3000,
    });
    await seed(t, {
      stripeTransferId: "tr_c4_pay",
      amount: 3000,
      reinstatement: true,
    });

    const claim = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "dp_reinst",
      sourceChargeId: "ch_claim",
      mode: { kind: "full" },
    });
    expect(claim.slices).toEqual([]);
  });

  it("a redelivered base transfer payload cannot clobber the claim frontier", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { stripeTransferId: "tr_c5", amount: 7000 });

    await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_5",
      sourceChargeId: "ch_claim",
      mode: { kind: "fraction", chargeAmount: 10000, amountRefunded: 4000 },
    });

    // transfer.updated redelivery re-upserts the base payload.
    await seed(t, { stripeTransferId: "tr_c5", amount: 7000 });

    // A rival operation still sees the 2800 frontier.
    const rival = await t.mutation(api.connect.mutations.claimReversalSlices, {
      operationId: "re_6",
      sourceChargeId: "ch_claim",
      mode: { kind: "fraction", chargeAmount: 10000, amountRefunded: 4000 },
    });
    expect(rival.slices).toEqual([]);
  });
});
