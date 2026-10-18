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

it("pins original native metering provenance and refuses replay against another meter or invoice payment", async () => {
  const t = convexTest(schema, modules);
  const opts = {
    sourceChargeId: "ch_meter",
    paymentIntentId: "pi_meter",
    sourceInvoiceId: "in_meter",
    gross: 100,
    currency: "usd",
    processingFee: 3,
    platformNet: 7,
    transfers: [
      {
        destinationAccountId: "acct_seller",
        amount: 90,
        role: "store" as const,
      },
    ],
    usageSource: {
      stripeAccountId: "acct_platform",
      customerAccount: "acct_buyer",
      livemode: false,
      meterId: "mtr_calls",
      stripePriceId: "price_calls",
      stripeProductId: "prod_calls",
      subscriptionId: "sub_calls",
      subscriptionItemId: "si_calls",
      invoicePaymentId: "inpay_meter",
      period: { start: 600, end: 1200 },
      model: "pay_as_you_go" as const,
    },
  };
  const first = await t.mutation(
    api.settlement.mutations.reserveSettlementAllocation,
    opts,
  );
  expect(first).toMatchObject({ usageSource: opts.usageSource });
  for (const changed of [
    { meterId: "mtr_other" },
    { invoicePaymentId: "inpay_other" },
  ])
    await expect(
      t.mutation(api.settlement.mutations.reserveSettlementAllocation, {
        ...opts,
        usageSource: { ...opts.usageSource, ...changed },
      }),
    ).rejects.toThrow(/source identity/i);
  await expect(
    t.mutation(api.settlement.mutations.reserveSettlementAllocation, {
      ...opts,
      usageSource: undefined,
    }),
  ).rejects.toThrow(/source identity/i);
});
