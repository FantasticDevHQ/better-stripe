import { expect, it } from "vitest";
import { componentsGeneric } from "convex/server";
import { initConvexTest } from "../setup.test.js";
import { schema, modules } from "../../test.js";
import type { Component, RunCtx } from "../helpers.js";
import { fixture } from "./invoiceSale.fixtures.js";
import { settleUsageInvoice } from "./settlement.js";
function setup() {
  const f = fixture(),
    t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const native: Record<string, unknown>[] = [];
  f.extra.set("/v1/charges/ch_source", {
    ...f.payment.latest_charge,
    created: 1200,
  });
  f.extra.set("/v1/transfers", (method: string, raw: string) => {
    if (method === "GET")
      return { object: "list", data: native, has_more: false };
    const body = new URLSearchParams(raw);
    const transfer = {
      id: `tr_${native.length}`,
      object: "transfer",
      amount: Number(body.get("amount")),
      currency: body.get("currency"),
      destination: body.get("destination"),
      source_transaction: body.get("source_transaction"),
      transfer_group: body.get("transfer_group"),
      metadata: {
        bsRole: body.get("metadata[bsRole]"),
        bsSourceCharge: body.get("metadata[bsSourceCharge]"),
      },
    };
    native.push(transfer);
    return transfer;
  });
  const input = {
    ...f.input,
    policy: { creatorAccountId: "acct_seller", feeBasisPoints: 900 },
  };
  return { ...f, t, component, native, input };
}
it("settles actual paid metered proceeds once using the existing immutable allocation and transfer ledger", async () => {
  const f = setup();
  const first = await f.t.action((ctx) =>
    settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, f.input),
  );
  expect(first).toMatchObject({
    status: "settled",
    gross: 1000,
    processingFee: 50,
    platformNet: 40,
    usageSource: {
      meterId: "mtr_calls",
      invoicePaymentId: "inpay_source",
      stripeProductId: "prod_original",
    },
    transfers: [
      { destinationAccountId: "acct_seller", amount: 910, role: "store" },
    ],
  });
  expect(
    await f.t.action((ctx) =>
      settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, {
        ...f.input,
        policy: { ...f.input.policy, feeBasisPoints: 9900 },
      }),
    ),
  ).toEqual(first);
  expect(f.native).toHaveLength(1);
});
it("never creates transfers from a zero invoice or a prepaid consumption invoice", async () => {
  for (const prepaid of [false, true]) {
    const f = setup();
    if (!prepaid) f.invoice.amount_paid = 0;
    const input = prepaid
      ? {
          ...f.input,
          binding: {
            ...f.input.binding,
            plan: {
              ...f.input.binding.plan,
              model: "prepaid" as const,
              insufficientBalance: "reject" as const,
            },
          },
        }
      : f.input;
    expect(
      await f.t.action((ctx) =>
        settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, input),
      ),
    ).toMatchObject({ status: "rejected" });
    expect(f.native).toHaveLength(0);
  }
});

it("keeps a zero initial metered invoice from consuming the one-time affiliate commission", async () => {
  const f = setup();
  const paid = {
    ...f.invoice,
    created: 1200,
    status_transitions: { finalized_at: 1200, paid_at: 1250 },
  };
  f.extra.set("/v1/invoices", {
    object: "list",
    has_more: false,
    data: [
      {
        ...paid,
        id: "in_zero",
        created: 600,
        amount_paid: 0,
        status_transitions: { finalized_at: 600, paid_at: 600 },
      },
      paid,
    ],
  });
  const result = await f.t.action((ctx) =>
    settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, {
      ...f.input,
      policy: {
        ...f.input.policy,
        commissionTerm: "one_time",
        affiliate: {
          destinationAccountId: "acct_affiliate",
          basisPoints: 2000,
        },
      },
    }),
  );
  expect(result).toMatchObject({
    status: "settled",
    transfers: [
      { destinationAccountId: "acct_seller", role: "store", amount: 728 },
      {
        destinationAccountId: "acct_affiliate",
        role: "affiliate",
        amount: 182,
      },
    ],
  });
  expect(f.native).toHaveLength(2);
});
it("recovers a native transfer whose ledger write failed without paying the metered invoice twice", async () => {
  const f = setup();
  let fail = true;
  const settle = () =>
    f.t.action((ctx) =>
      settleUsageInvoice(
        f.sdk,
        f.component,
        {
          ...ctx,
          runMutation: async (ref, args) => {
            if (
              fail &&
              String(
                ref[Symbol.for("toReferencePath") as keyof typeof ref],
              ).includes("upsertTransfer")
            ) {
              fail = false;
              throw new Error("receipt storage unavailable");
            }
            return ctx.runMutation(ref, args);
          },
        } as RunCtx,
        f.input,
      ),
    );
  await expect(settle()).rejects.toThrow("receipt storage unavailable");
  expect(f.native).toHaveLength(1);
  expect(await settle()).toMatchObject({
    status: "settled",
    usageSource: { invoicePaymentId: "inpay_source" },
  });
  expect(f.native).toHaveLength(1);
});
