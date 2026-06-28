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

    const byCharge = await t.query(api.connect.queries.listTransfersByCharge, {
      sourceChargeId: "ch_split",
    });
    expect(byCharge).toHaveLength(2);

    const byAccount = await t.query(
      api.connect.queries.listTransfersByAccount,
      { destinationAccountId: "acct_store" },
    );
    expect(byAccount).toHaveLength(1);
    expect(byAccount[0].stripeTransferId).toBe("tr_store");
  });
});
