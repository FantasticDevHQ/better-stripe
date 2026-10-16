import { modules } from "../../test";

// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's per-user data scoping (`queries.ts`).
 *
 * BTS-5: the billing page must only ever surface the signed-in persona's own
 * subscriptions and invoices — never another account's. The component is what
 * actually filters by `userId`; these tests register it (from the built output
 * the example resolves) and seed two users' rows, then assert each example
 * query (`listSubscriptionsByUser`, `listInvoicesByUser`) returns only the
 * requested user's data. This is the testable encoding of the acceptance
 * criteria; the React wiring in `billing.tsx` is covered by inspection per the
 * project's no-RTL testing strategy.
 */
import { convexTest } from "convex-test";

import { describe, expect, it } from "vitest";

import { api, components } from "../_generated/api";

import schema from "../schema";

// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../../dist/component/schema.js";

const componentModules = import.meta.glob("../../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}
describe("queries — listDisputes scopes to a seller's store (BTS-44)", () => {
  it("returns only the requested account's disputes, not another store's", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_maya",
      accountId: "acct_maya",
      amount: 5000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: false,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_sasha",
      accountId: "acct_sasha",
      amount: 9000,
      currency: "usd",
      status: "warning_needs_response",
      reason: "fraudulent",
      isChargeRefundable: true,
    });

    const maya = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_maya",
    });
    expect(maya.map((d) => d.stripeDisputeId)).toEqual(["dp_maya"]);

    const sasha = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_sasha",
    });
    expect(sasha.map((d) => d.stripeDisputeId)).toEqual(["dp_sasha"]);
  });

  it("returns an empty array for a store with no disputes (no leakage)", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_maya",
      accountId: "acct_maya",
      amount: 5000,
      currency: "usd",
      status: "needs_response",
      reason: "product_not_received",
      isChargeRefundable: false,
    });

    const empty = await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_unknown",
    });
    expect(empty).toEqual([]);
  });
});

describe("queries — listRefunds supports the seller refund history UI (BTS-80)", () => {
  it("returns webhook-shaped refunds when the UI scopes history by PaymentIntent", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertRefund, {
      stripeRefundId: "re_webhook_refund",
      stripePaymentIntentId: "pi_refunded_sale",
      stripeChargeId: "ch_refunded_sale",
      amount: 2500,
      currency: "usd",
      status: "succeeded",
      reason: "requested_by_customer",
    });

    const refundHistoryArgs = {
      stripePaymentIntentId: "pi_refunded_sale",
    };
    const paymentScoped = await t.query(
      api.connect.queries.listRefunds,
      refundHistoryArgs,
    );

    expect(paymentScoped.map((refund) => refund.stripeRefundId)).toEqual([
      "re_webhook_refund",
    ]);

    const oldAccountScopedArgs = {
      accountId: "acct_maya",
      stripePaymentIntentId: "pi_refunded_sale",
    };
    const oldAccountScoped = await t.query(
      api.connect.queries.listRefunds,
      oldAccountScopedArgs,
    );
    expect(oldAccountScoped).toEqual([]);
  });
});

describe("queries — getDisputeChargeback exposes clawback ledger (BTS-82)", () => {
  it("summarizes transfer reversals for the disputed charge", async () => {
    const t = withComponent();

    await t.mutation(components.betterStripe.connect.mutations.upsertDispute, {
      stripeDisputeId: "dp_chargeback",
      stripeChargeId: "ch_chargeback",
      accountId: "acct_maya",
      amount: 9000,
      currency: "usd",
      status: "lost",
      reason: "fraudulent",
      isChargeRefundable: false,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_store",
      sourceChargeId: "ch_chargeback",
      destinationAccountId: "acct_maya",
      amount: 8000,
      currency: "usd",
      role: "store",
      status: "paid",
      reversedAmount: 8000,
    });
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: "tr_affiliate",
      sourceChargeId: "ch_chargeback",
      destinationAccountId: "acct_affiliate",
      amount: 1000,
      currency: "usd",
      role: "affiliate",
      status: "paid",
      reversedAmount: 500,
    });

    const result = await t.query(api.connect.queries.getDisputeChargeback, {
      stripeDisputeId: "dp_chargeback",
    });

    expect(result).not.toBeNull();
    expect(result!.gross).toBe(9000);
    expect(result!.reversed).toBe(8500);
    expect(result!.net).toBe(500);
    expect(result!.transfers.map((t) => t.stripeTransferId).sort()).toEqual([
      "tr_affiliate",
      "tr_store",
    ]);
  });

  it("returns null when the dispute is not found", async () => {
    const t = withComponent();

    await expect(
      t.query(api.connect.queries.getDisputeChargeback, {
        stripeDisputeId: "dp_missing",
      }),
    ).resolves.toBeNull();
  });
});

describe("earnings hook aggregate wiring", () => {
  it("returns aggregate objects with transfer rows and excludes other accounts", async () => {
    const t = withComponent();
    for (const destination of ["acct_affiliate", "acct_other"]) {
      await t.mutation(
        components.betterStripe.connect.mutations.upsertTransfer,
        {
          stripeTransferId: `tr_${destination}`,
          destinationAccountId: destination,
          sourceChargeId: "ch_split",
          role: "affiliate",
          amount: 1936,
          currency: "usd",
          status: "paid",
        },
      );
    }
    const earnings = await t.query(api.connect.queries.getAccountEarnings, {
      destinationAccountId: "acct_affiliate",
    });
    expect(earnings).toMatchObject({
      gross: 1936,
      reversed: 0,
      transferCount: 1,
    });
    expect(earnings.transfers.map((row) => row.stripeTransferId)).toEqual([
      "tr_acct_affiliate",
    ]);
    expect(
      await t.query(api.connect.queries.getAccountPayouts, {
        accountId: "acct_affiliate",
      }),
    ).toEqual({ paidOut: 0, payoutCount: 0, payouts: [] });
  });
});

it("shows the originating store on affiliate sales, including older split transfers", async () => {
  const t = withComponent();
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Maya Seller",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_maya",
      storeName: "Maya's Fitness Studio",
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("storeSales", {
      sellerId,
      sellerAccountId: "acct_maya",
      affiliateAccountId: "acct_affiliate",
      chargeId: "ch_new",
      paymentIntentId: "pi_new",
      planId: "starter",
      gross: 10000,
      processingFee: 320,
      sellingFee: 900,
      platformNet: 580,
      sellerNet: 7280,
      affiliateNet: 1820,
      currency: "usd",
      status: "settled",
    }),
  );
  for (const charge of ["ch_new", "ch_old", "ch_unknown"]) {
    await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
      stripeTransferId: `tr_${charge}`,
      destinationAccountId: "acct_affiliate",
      sourceChargeId: charge,
      role: "affiliate",
      amount: 1820,
      currency: "usd",
      status: "paid",
    });
  }
  await t.mutation(components.betterStripe.connect.mutations.upsertTransfer, {
    stripeTransferId: "tr_old_store",
    destinationAccountId: "acct_maya",
    sourceChargeId: "ch_old",
    role: "store",
    amount: 7280,
    currency: "usd",
    status: "paid",
  });
  const rows = await t.query(api.connect.queries.listAffiliateSales, {
    accountId: "acct_affiliate",
  });
  expect(rows).toHaveLength(3);
  for (const charge of ["ch_new", "ch_old"])
    expect(rows.find((row) => row.sourceChargeId === charge)?.storeName).toBe(
      "Maya's Fitness Studio",
    );
  expect(
    rows.find((row) => row.sourceChargeId === "ch_unknown")?.storeName,
  ).toBeNull();
  const first = await t.query(api.connect.queries.paginateAffiliateSales, {
    accountId: "acct_affiliate",
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);
  const last = await t.query(api.connect.queries.paginateAffiliateSales, {
    accountId: "acct_affiliate",
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(last.isDone).toBe(true);
  expect(last.page).toHaveLength(1);
  const paged = [...first.page, ...last.page];
  expect(new Set(paged.map((row) => row.stripeTransferId)).size).toBe(3);
  expect(paged).toEqual(rows);
});
