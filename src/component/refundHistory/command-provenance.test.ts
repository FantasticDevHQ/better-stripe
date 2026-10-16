import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
import { refundCommandBinding } from "./commandBinding.js";
const key = "dojo-refund:provenance_command:v1";
const metadata = { betterStripeRefundCommand: key };
const scope = {
  commandKey: key,
  accountId: "acct_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  currency: "jpy",
};
const read = api.refundHistory.queries.getRefundCommandEvidence;

it("preserves first observed binding time without treating legacy insertion as provider creation", () => {
  const first = refundCommandBinding({ metadata }, {}, 2000);
  expect(first.refundCommandObservedAt).toBe(2000);
  const later = refundCommandBinding(
    { ...first, metadata },
    { metadata },
    3000,
  );
  expect(later.refundCommandObservedAt).toBe(2000);
});

it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
  "holds malformed or future observed binding time %s",
  async (observedAt) => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertRefund, {
      stripeRefundId: "re_original",
      accountId: scope.accountId,
      stripePaymentIntentId: scope.stripePaymentIntentId,
      stripeChargeId: scope.stripeChargeId,
      currency: "jpy",
      amount: 125,
      status: "succeeded",
      metadata,
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("refunds")
        .withIndex("by_stripe_refund_id", (q) =>
          q.eq("stripeRefundId", "re_original"),
        )
        .unique();
      if (!row) throw new Error("Missing QA refund");
      await ctx.db.patch("refunds", row._id, {
        refundCommandObservedAt: observedAt,
      });
    });
    expect(await t.query(read, scope)).toEqual({
      status: "unavailable",
      reason: "invalid_receipt",
    });
  },
);
