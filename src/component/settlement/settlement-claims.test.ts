// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
it("keeps a claimed allocation immutable and isolated per source charge", async () => {
  const t = convexTest(schema, modules);
  const opts = {
    sourceChargeId: "ch_1",
    paymentIntentId: "pi_1",
    gross: 100,
    currency: "usd",
    processingFee: 3,
    platformNet: 7,
    transfers: [
      { destinationAccountId: "acct_c", amount: 90, role: "store" as const },
    ],
  };
  const first = await t.mutation(
    api.settlement.mutations.reserveSettlementAllocation,
    opts,
  );
  const replay = await t.mutation(
    api.settlement.mutations.reserveSettlementAllocation,
    {
      ...opts,
      transfers: [{ ...opts.transfers[0], amount: 80 }],
      platformNet: 17,
    },
  );
  expect(replay).toEqual(first);
  await expect(
    t.mutation(api.settlement.mutations.reserveSettlementAllocation, {
      ...opts,
      sourceChargeId: "ch_invalid",
      gross: 1,
    }),
  ).rejects.toThrow();
});
it("persists the term, identity and earliest invoice despite replay and term changes", async () => {
  const t = convexTest(schema, modules);
  const opts = {
    subscriptionId: "sub_1",
    invoiceId: "in_renewal",
    firstPaidInvoiceId: "in_first",
    term: "one_time" as const,
    affiliateAccountId: "acct_a",
  };
  expect(
    await t.mutation(api.settlement.mutations.claimCommissionInvoice, opts),
  ).toMatchObject({
    eligible: false,
    firstPaidInvoiceId: "in_first",
    term: "one_time",
    replay: false,
  });
  expect(
    await t.mutation(api.settlement.mutations.claimCommissionInvoice, {
      ...opts,
      invoiceId: "in_first",
      term: "forever",
    }),
  ).toMatchObject({ eligible: true, term: "one_time" });
  expect(
    await t.mutation(api.settlement.mutations.claimCommissionInvoice, {
      ...opts,
      invoiceId: "in_first",
    }),
  ).toMatchObject({ eligible: true, replay: true });
  await expect(
    t.mutation(api.settlement.mutations.claimCommissionInvoice, {
      ...opts,
      affiliateAccountId: "acct_other",
    }),
  ).rejects.toThrow();
});
