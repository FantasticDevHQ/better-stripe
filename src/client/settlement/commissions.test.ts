import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import type { Component, RunCtx } from "../helpers.js";
import { selectCommissionInvoice } from "./commissions.js";
const ref = (path: string) => ({
  [Symbol.for("toReferencePath")]: `betterStripe/${path}`,
});
const component = {
  settlement: {
    commissions: {
      get: ref("settlement/queries/getCommissionTerm"),
      claim: ref("settlement/mutations/claimCommissionInvoice"),
    },
  },
} as unknown as Component;
it("finds the first paid nonzero invoice across provider pages and ignores trial invoices", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          id: "in_later",
          amount_paid: 100,
          status_transitions: { paid_at: 20 },
          created: 20,
        },
        {
          id: "in_trial",
          amount_paid: 0,
          status_transitions: { paid_at: 1 },
          created: 1,
        },
      ],
      has_more: true,
    })
    .mockResolvedValueOnce({
      data: [
        {
          id: "in_first",
          amount_paid: 100,
          status_transitions: { paid_at: 10 },
          created: 2,
        },
      ],
      has_more: false,
    });
  const raw = {
    invoices: {
      list,
      retrieve: vi.fn().mockResolvedValue({
        id: "in_later",
        status: "paid",
        amount_paid: 100,
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    },
  };
  const runMutation = vi.fn(async (_ref, args) => ({
    ...args,
    eligible: false,
    replay: false,
    claimKey: "key",
  }));
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation,
  } as unknown as RunCtx;
  await selectCommissionInvoice(raw as unknown as Stripe, component, ctx, {
    subscriptionId: "sub_1",
    invoiceId: "in_later",
    affiliateAccountId: "acct_a",
    term: "one_time",
  });
  expect(runMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      firstPaidInvoiceId: "in_first",
      term: "one_time",
    }),
  );
  expect(list).toHaveBeenCalledTimes(2);
});
it("does not consume a failed or zero-dollar invoice", async () => {
  const raw = {
    invoices: {
      retrieve: vi.fn().mockResolvedValue({
        id: "in_trial",
        status: "paid",
        amount_paid: 0,
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    },
  };
  const mutation = vi.fn(),
    ctx = { runQuery: vi.fn(), runMutation: mutation } as unknown as RunCtx;
  expect(
    await selectCommissionInvoice(raw as unknown as Stripe, component, ctx, {
      subscriptionId: "sub_1",
      invoiceId: "in_trial",
    }),
  ).toMatchObject({ status: "not_payable", eligible: false });
  expect(mutation).not.toHaveBeenCalled();
});
