import { expect, it } from "vitest";
import { componentsGeneric } from "convex/server";
import { initConvexTest } from "../setup.test.js";
import { schema, modules } from "../../test.js";
import type { Component, RunCtx } from "../helpers.js";
import { mixed } from "./mixedInvoice.fixtures.js";
import { settleUsageInvoice } from "./settlement.js";
import { retainedInvoiceSource } from "./retainedInvoiceSource.js";
function setup() {
  const f = mixed(),
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
it("retains complete mixed lineage, conserves whole proceeds, and recovers a lost receipt without a second transfer", async () => {
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
              throw new Error("lost receipt");
            }
            return ctx.runMutation(ref, args);
          },
        } as RunCtx,
        f.input,
      ),
    );
  await expect(settle()).rejects.toThrow("lost receipt");
  expect(f.native).toHaveLength(1);
  const result = await settle();
  expect(result).toMatchObject({
    status: "settled",
    gross: 3000,
    processingFee: 120,
    platformNet: 150,
    transfers: [{ amount: 2730 }],
    usageSource: {
      invoiceLines: [
        { lineId: "il_base", amount: 2000 },
        { lineId: "il_source", amount: 1000 },
      ],
    },
  });
  expect(f.native).toHaveLength(1);
  Object.assign(f.line, { period: { start: 601, end: 1200 } });
  await expect(settle()).rejects.toThrow(/source identity/i);
  expect(f.native).toHaveLength(1);
});
it("reauthorizes at reserve and before a new transfer, holding a seller remap", async () => {
  const f = setup();
  const phases: string[] = [];
  await expect(
    f.t.action((ctx) =>
      settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, {
        ...f.input,
        authorize: async (context) => {
          phases.push(context.phase);
          if (context.phase === "transfer") throw new Error("seller remapped");
        },
      }),
    ),
  ).rejects.toThrow("seller remapped");
  expect(phases).toEqual(["reserve", "transfer"]);
  expect(f.native).toHaveLength(0);
});
it("allows refund/dispute cost reads only against sealed complete native lines and never recognizes refund proceeds as a new sale", async () => {
  const f = setup();
  await f.t.action((ctx) =>
    settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, f.input),
  );
  Object.assign(f.payment.latest_charge, {
    amount_refunded: 700,
    disputed: true,
  });
  const read = () =>
    f.t.action((ctx) =>
      retainedInvoiceSource(f.sdk, f.component, ctx as RunCtx, {
        paymentIntentId: "pi_source",
        customerAccountId: "acct_customer",
        gross: 3000,
        currency: "usd",
      }),
    );
  expect(await read()).toMatchObject({
    status: "ready",
    value: { gross: 3000, processingFee: 120 },
  });
  expect(
    await f.t.action((ctx) =>
      settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, f.input),
    ),
  ).toMatchObject({ status: "rejected", reason: "payment_not_payable" });
  f.base.pricing.price_details.product = "prod_foreign";
  expect(await read()).toMatchObject({ status: "rejected" });
  expect(f.native).toHaveLength(1);
});

it("rejects a substituted original funding receipt during recovery", async () => {
  const f = setup();
  await f.t.action((ctx) =>
    settleUsageInvoice(f.sdk, f.component, ctx as RunCtx, f.input),
  );
  f.funding.id = "inpay_substituted";
  const result = await f.t.action((ctx) =>
    retainedInvoiceSource(f.sdk, f.component, ctx as RunCtx, {
      paymentIntentId: "pi_source",
      customerAccountId: "acct_customer",
      gross: 3000,
      currency: "usd",
    }),
  );
  expect(result).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(f.native).toHaveLength(1);
});
