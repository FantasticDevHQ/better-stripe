// @vitest-environment edge-runtime
/**
 * Tests for the earnings AGGREGATE queries (BTS-64). The row-list queries
 * (`listTransfersByAccount`, `listPayouts`) `.take(50)`, so a busy account's
 * earnings totals were silently truncated when summed client-side. These
 * aggregate queries iterate the account's ledger to completion and return
 * EXACT gross/reversed/paidOut regardless of row count, plus a bounded preview
 * of rows for drill-down UIs.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
import { getAccountEarnings, getAccountPayouts } from "../connect/queries.js";

describe("getAccountEarnings — exact totals past the 50-row cap (BTS-64)", () => {
  it("sums gross and reversed over ALL transfers for an account, not just the first 50", async () => {
    const t = convexTest(schema, modules);

    // 120 transfers for one account — more than the 50-row list cap. Each is
    // 100 gross with 10 reversed, so exact totals are gross 12000 / reversed 1200.
    for (let i = 0; i < 120; i++) {
      await t.mutation(api.connect.mutations.upsertTransfer, {
        stripeTransferId: `tr_big_${i}`,
        destinationAccountId: "acct_big",
        amount: 100,
        reversedAmount: 10,
        currency: "usd",
        status: "paid",
      });
    }
    // A different account's rows must not leak into the total (index scoping).
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_other",
      destinationAccountId: "acct_other",
      amount: 99999,
      currency: "usd",
      status: "paid",
    });

    const result = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_big",
    });

    expect(result.gross).toBe(12000);
    expect(result.reversed).toBe(1200);
    expect(result.transferCount).toBe(120);
    // The preview is still bounded (drill-down rows), but the totals are exact.
    expect(result.transfers.length).toBe(50);
    expect(result.transfers[0].stripeTransferId).toBe("tr_big_119");
    expect(
      result.transfers.some((row) => row.stripeTransferId === "tr_big_0"),
    ).toBe(false);
    const newest = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_big",
      previewLimit: 1,
    });
    expect(newest.transfers.map((row) => row.stripeTransferId)).toEqual([
      "tr_big_119",
    ]);
    expect(newest.gross).toBe(12000);
  });

  it("returns exact totals and all rows for a small account (regression)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_a",
      destinationAccountId: "acct_small",
      amount: 8000,
      reversedAmount: 1000,
      currency: "usd",
      status: "paid",
    });
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_b",
      destinationAccountId: "acct_small",
      amount: 500,
      currency: "usd",
      status: "paid",
    });

    const result = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_small",
    });

    expect(result.gross).toBe(8500);
    expect(result.reversed).toBe(1000);
    expect(result.transferCount).toBe(2);
    expect(result.transfers.length).toBe(2);
  });

  it("is zero for an account with no transfers", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_none",
    });
    expect(result).toEqual({
      gross: 0,
      reversed: 0,
      transferCount: 0,
      transfers: [],
    });
  });

  // Regression guard for the pagination LOOP itself (BTS-64). The other tests
  // use fewer rows than EARNINGS_PAGE_SIZE (200), so they fit in ONE
  // `.paginate()` page and never exercise the cursor-advance across pages. This
  // seeds 450 transfers → 3 pages, so a broken loop (e.g. reading only the first
  // `.paginate({ numItems: 200 })` page, or an off-by-one at a page boundary)
  // would understate gross/reversed and FAIL here rather than silently ship
  // wrong money totals for busy accounts.
  it("stitches totals across MULTIPLE pages (450 transfers > page size)", async () => {
    const t = convexTest(schema, modules);

    // 450 transfers, each 100 gross / 10 reversed → exact 45000 / 4500 only if
    // every page is summed (a single 200-row page would give 20000 / 2000).
    // Persisted-history fixture isolates the pagination reader from unrelated
    // upsert diagnostics. The 120-row and small-account cases cover actual upserts.
    await t.run(async (ctx) => {
      for (let i = 0; i < 450; i++) {
        await ctx.db.insert("transfers", {
          stripeTransferId: `tr_mp_${i}`,
          destinationAccountId: "acct_mp",
          amount: 100,
          reversedAmount: 10,
          currency: "usd",
          status: "paid",
        });
      }
    });
    // A second account's rows must not leak in across pages either.
    await t.mutation(api.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_mp_other",
      destinationAccountId: "acct_mp_other",
      amount: 77777,
      currency: "usd",
      status: "paid",
    });

    const result = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_mp",
    });

    expect(result.transferCount).toBe(450);
    expect(result.gross).toBe(45000);
    expect(result.reversed).toBe(4500);
    // Preview stays bounded even as the exact totals span pages.
    expect(result.transfers.length).toBe(50);
  });
});

describe("getAccountPayouts — exact paidOut past the 50-row cap (BTS-64)", () => {
  it("sums paid payouts over ALL rows, not just the first 50", async () => {
    const t = convexTest(schema, modules);

    // 60 paid payouts (>50) at 100 each → exact paidOut 6000.
    for (let i = 0; i < 60; i++) {
      await t.mutation(api.connect.mutations.upsertPayout, {
        stripePayoutId: `po_big_${i}`,
        accountId: "acct_big",
        amount: 100,
        currency: "usd",
        status: "paid",
      });
    }
    // Pending rows must not count toward paidOut.
    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_pending",
      accountId: "acct_big",
      amount: 5000,
      currency: "usd",
      status: "pending",
    });

    const result = await t.query(api.connect.queries.getAccountPayouts, {
      accountId: "acct_big",
    });

    expect(result.paidOut).toBe(6000);
    expect(result.payoutCount).toBe(61);
    expect(result.payouts.length).toBe(50);
  });

  // Regression guard for the pagination loop + paid-only filtering ACROSS pages
  // (BTS-64). 420 payouts (> EARNINGS_PAGE_SIZE) alternating paid/pending: only
  // a loop that sums every page AND filters by status on each page yields the
  // exact paidOut. A single-page read would understate it.
  it("sums paid-only across MULTIPLE payout pages (420 rows > page size)", async () => {
    const t = convexTest(schema, modules);

    // 210 paid + 210 pending, interleaved → exact paidOut 21000 (paid only).
    for (let i = 0; i < 420; i++) {
      await t.mutation(api.connect.mutations.upsertPayout, {
        stripePayoutId: `po_mp_${i}`,
        accountId: "acct_mp",
        amount: 100,
        currency: "usd",
        status: i % 2 === 0 ? "paid" : "pending",
      });
    }

    const result = await t.query(api.connect.queries.getAccountPayouts, {
      accountId: "acct_mp",
    });

    expect(result.payoutCount).toBe(420);
    expect(result.paidOut).toBe(210 * 100);
  });
});

// convex-test does not enforce production document/byte read limits. Simulate
// a database iterator reaching that boundary after a row has been accumulated.
// The aggregate must reject rather than exposing the partial financial total.
describe("aggregate read-limit failures (BTS-116)", () => {
  it.each([
    ["earnings", getAccountEarnings, { destinationAccountId: "acct_limit" }],
    ["payouts", getAccountPayouts, { accountId: "acct_limit" }],
  ])("rejects incomplete %s totals", async (_name, query, args) => {
    const readLimit = new Error(
      "Too many documents read in a single function execution",
    );
    const rows = {
      order: () => rows,
      async *[Symbol.asyncIterator]() {
        yield { amount: 100, reversedAmount: 10, status: "paid" };
        throw readLimit;
      },
    };
    const ctx = { db: { query: () => ({ withIndex: () => rows }) } };
    const registered = query as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    };
    await expect(registered._handler(ctx, args)).rejects.toBe(readLimit);
  });
});
