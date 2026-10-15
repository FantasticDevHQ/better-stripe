import { componentsGeneric, type FunctionReference } from "convex/server";
import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import schema from "../component/schema.js";
import { initConvexTest } from "./setup.test.js";
import { CostRecoveryClient } from "./costRecovery.js";
import type { Component, RunCtx } from "./helpers.js";
const modules = import.meta.glob("../component/**/*.{ts,js,tsx,jsx}");
const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
const options = { ...scope, groupKey: "invoice:in_1" };
async function setup(amount = 320) {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => t.mutation(ref, args),
  } as unknown as RunCtx;
  const invoice = {
    id: "in_1",
    customer_account: scope.accountId,
    currency: "usd",
    status: "draft",
  };
  const items: Stripe.InvoiceItem[] = [];
  const provider = {
    invoices: { retrieve: vi.fn(async () => invoice) },
    invoiceItems: {
      list: vi.fn(() =>
        (async function* () {
          for (const item of items) yield item;
        })(),
      ),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const item = {
          id: "ii_recovery",
          ...params,
        } as unknown as Stripe.InvoiceItem;
        items.push(item);
        return item;
      }),
    },
  };
  const recovery = new CostRecoveryClient(
    componentsGeneric().betterStripe as unknown as Component,
    () => provider as unknown as Stripe,
  );
  await recovery.recordClaim(ctx, {
    ...scope,
    claimKey: "fee:ch_original",
    sourceChargeId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    amountDue: amount,
    revision: 1,
  });
  await recovery.reserve(ctx, {
    ...options,
    operationKey: "batch1",
    sourceKind: "invoice",
    sourceId: invoice.id,
    maxDebit: 10000,
    maxCredit: 10000,
  });
  await recovery.seal(ctx, { groupKey: options.groupKey });
  return { ctx, recovery, invoice, items, provider };
}
it("attaches one signed adjustment to an authorized draft invoice and keeps claims reserved", async () => {
  const { ctx, recovery, provider } = await setup(-320);
  const result = await recovery.attachInvoice(ctx, options);
  expect(result.invoiceItemId).toBe("ii_recovery");
  expect(provider.invoiceItems.create).toHaveBeenCalledWith(
    expect.objectContaining({
      invoice: "in_1",
      customer_account: "acct_owner",
      currency: "usd",
      amount: -320,
      discountable: false,
    }),
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: -320,
    collectedAmount: 0,
    outstanding: 0,
  });
  await recovery.attachInvoice(ctx, options);
  expect(provider.invoiceItems.create).toHaveBeenCalledTimes(1);
});
it("rejects invoice ownership, currency and host scope mismatches before creating items", async () => {
  const { ctx, recovery, invoice, provider } = await setup();
  await expect(
    recovery.attachInvoice(ctx, { ...options, scopeKey: "other" }),
  ).rejects.toThrow(/scope/i);
  invoice.customer_account = "acct_other";
  await expect(recovery.attachInvoice(ctx, options)).rejects.toThrow(/owner/i);
  invoice.customer_account = scope.accountId;
  invoice.currency = "eur";
  await expect(recovery.attachInvoice(ctx, options)).rejects.toThrow(
    /currency/i,
  );
  expect(provider.invoiceItems.create).not.toHaveBeenCalled();
});
it("recovers provider success after persistence failure by scanning the exact invoice completely", async () => {
  const { ctx, recovery, items, provider } = await setup();
  const mutation = ctx.runMutation! as (
    ref: FunctionReference<"mutation">,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  ctx.runMutation = vi.fn(
    async (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      if (items.length) throw new Error("host persistence failed");
      return mutation(ref, args);
    },
  ) as RunCtx["runMutation"];
  await expect(recovery.attachInvoice(ctx, options)).rejects.toThrow(
    "host persistence failed",
  );
  ctx.runMutation = mutation as RunCtx["runMutation"];
  items.unshift(
    ...Array.from(
      { length: 105 },
      (_, i) => ({ id: `ii_other_${i}`, metadata: {} }) as Stripe.InvoiceItem,
    ),
  );
  expect((await recovery.attachInvoice(ctx, options)).invoiceItemId).toBe(
    "ii_recovery",
  );
  expect(provider.invoiceItems.list).toHaveBeenCalledWith({
    invoice: "in_1",
    limit: 100,
  });
  expect(provider.invoiceItems.create).toHaveBeenCalledTimes(1);
});
it("does not create new adjustments after finalization or recreate a deleted bound item", async () => {
  const { ctx, recovery, invoice, items, provider } = await setup();
  invoice.status = "open";
  await expect(recovery.attachInvoice(ctx, options)).rejects.toThrow(/draft/i);
  invoice.status = "draft";
  await recovery.attachInvoice(ctx, options);
  items.length = 0;
  await expect(recovery.attachInvoice(ctx, options)).rejects.toThrow(
    /missing/i,
  );
  expect(provider.invoiceItems.create).toHaveBeenCalledTimes(1);
});
it("preserves provider errors and keeps unknown outcomes reserved", async () => {
  const { ctx, recovery, provider } = await setup();
  const failure = new Error("network interrupted");
  provider.invoiceItems.create.mockRejectedValue(failure);
  await expect(recovery.attachInvoice(ctx, options)).rejects.toBe(failure);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 320,
    collectedAmount: 0,
  });
});
it("collects only after verified payment and replays completion without collecting twice", async () => {
  const { ctx, recovery, invoice } = await setup();
  await recovery.attachInvoice(ctx, options);
  invoice.status = "open";
  expect((await recovery.reconcileInvoice(ctx, options)).isDone).toBe(false);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 320,
    collectedAmount: 0,
  });
  invoice.status = "paid";
  expect((await recovery.reconcileInvoice(ctx, options)).isDone).toBe(true);
  await recovery.reconcileInvoice(ctx, options);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 0,
    collectedAmount: 320,
    outstanding: 0,
  });
});
it("releases verified void invoices, and uncollectible invoices only under explicit host policy", async () => {
  const { ctx, recovery, invoice } = await setup();
  await recovery.attachInvoice(ctx, options);
  invoice.status = "uncollectible";
  expect((await recovery.reconcileInvoice(ctx, options)).isDone).toBe(false);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 320,
  });
  invoice.status = "void";
  await recovery.reconcileInvoice(ctx, options);
  await recovery.reconcileInvoice(ctx, options);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 0,
    collectedAmount: 0,
    outstanding: 320,
  });
  const other = await setup();
  await other.recovery.attachInvoice(other.ctx, options);
  other.invoice.status = "uncollectible";
  await other.recovery.reconcileInvoice(other.ctx, {
    ...options,
    releaseUncollectible: true,
  });
  expect(await other.recovery.balance(other.ctx, scope)).toMatchObject({
    reservedAmount: 0,
    outstanding: 320,
  });
});
it("retains source changes while an invoice is unpaid and carries the signed difference forward", async () => {
  const { ctx, recovery, invoice } = await setup();
  await recovery.attachInvoice(ctx, options);
  await recovery.recordClaim(ctx, {
    ...scope,
    claimKey: "fee:ch_original",
    sourceChargeId: "ch_original",
    sourceGross: 10000,
    sourceProcessingFee: 320,
    amountDue: 0,
    revision: 2,
  });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 320,
    outstanding: -320,
  });
  await expect(
    recovery.reserve(ctx, {
      ...scope,
      groupKey: "settlement:pi_2",
      operationKey: "other",
      sourceKind: "settlement",
      sourceId: "pi_2",
      sourceGross: 1000,
      sourceProcessingFee: 59,
      maxDebit: 1000,
      maxCredit: 1000,
    }),
  ).rejects.toThrow();
  invoice.status = "paid";
  await recovery.reconcileInvoice(ctx, options);
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    collectedAmount: 320,
    reservedAmount: 0,
    outstanding: -320,
  });
});
it("refuses altered or duplicate adjustment items before marking any claim collected", async () => {
  const { ctx, recovery, invoice, items } = await setup();
  await recovery.attachInvoice(ctx, options);
  invoice.status = "paid";
  items[0].amount = 1;
  await expect(recovery.reconcileInvoice(ctx, options)).rejects.toThrow(
    /economics/i,
  );
  items[0].amount = 320;
  items.push({ ...items[0], id: "ii_duplicate" });
  await expect(recovery.reconcileInvoice(ctx, options)).rejects.toThrow(
    /duplicate/i,
  );
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    reservedAmount: 320,
    collectedAmount: 0,
  });
});
it("preserves funding-charge economics when a collected invoice payment is partially refunded", async () => {
  const { ctx, recovery, invoice, provider } = await setup();
  await recovery.attachInvoice(ctx, options);
  invoice.status = "paid";
  await recovery.reconcileInvoice(ctx, options);
  Object.assign(invoice, { amount_paid: 10000 });
  Object.assign(provider, {
    invoicePayments: {
      list: () =>
        (async function* () {
          yield {
            id: "inpay_1",
            invoice: "in_1",
            status: "paid",
            amount_paid: 10000,
            currency: "usd",
            payment: { type: "payment_intent", payment_intent: "pi_funding" },
          };
        })(),
    },
    paymentIntents: {
      retrieve: async () => ({
        id: "pi_funding",
        status: "succeeded",
        amount_received: 10000,
        currency: "usd",
        metadata: {},
        latest_charge: {
          id: "ch_funding",
          amount: 10000,
          amount_captured: 10000,
          amount_refunded: 5000,
          currency: "usd",
          disputed: false,
          payment_intent: "pi_funding",
          balance_transaction: {
            id: "txn_original",
            amount: 10000,
            fee: 320,
            net: 9680,
            currency: "usd",
            created: 1800000000,
          },
        },
      }),
    },
    refunds: {
      list: () =>
        (async function* () {
          yield {
            id: "re_half",
            charge: "ch_funding",
            payment_intent: "pi_funding",
            amount: 5000,
            currency: "usd",
            status: "succeeded",
            balance_transaction: {
              id: "txn_refund",
              amount: -5000,
              fee: 0,
              net: -5000,
              currency: "usd",
              created: 1800000001,
            },
            failure_balance_transaction: null,
          };
        })(),
    },
    disputes: { list: () => (async function* () {})() },
  });
  const result = await recovery.rollbackInvoice(ctx, {
    ...options,
    revision: 1,
  });
  expect(result).toMatchObject({
    status: "ready",
    claim: {
      sourceChargeId: "ch_funding",
      sourceGross: 10000,
      sourceProcessingFee: 320,
      amountDue: 160,
    },
  });
  await recovery.rollbackInvoice(ctx, { ...options, revision: 1 });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: 480,
    collectedAmount: 320,
    outstanding: 160,
  });
  expect(
    await recovery.getClaim(ctx, { claimKey: "fee:ch_original" }),
  ).toMatchObject({ amountDue: 320, sourceChargeId: "ch_original" });
});
it("does not guess funding allocations for multi-payment invoices", async () => {
  const { ctx, recovery, invoice, provider } = await setup();
  await recovery.attachInvoice(ctx, options);
  invoice.status = "paid";
  await recovery.reconcileInvoice(ctx, options);
  Object.assign(invoice, { amount_paid: 10000 });
  Object.assign(provider, {
    invoicePayments: {
      list: () =>
        (async function* () {
          for (let i = 0; i < 2; i++)
            yield {
              id: `inpay_${i}`,
              invoice: "in_1",
              status: "paid",
              amount_paid: 5000,
              currency: "usd",
              payment: { type: "payment_intent", payment_intent: `pi_${i}` },
            };
        })(),
    },
  });
  expect(
    await recovery.rollbackInvoice(ctx, { ...options, revision: 1 }),
  ).toMatchObject({
    status: "not_ready",
    reason: "invoice_funding_allocation_required",
  });
  expect(await recovery.balance(ctx, scope)).toMatchObject({
    amountDue: 320,
    collectedAmount: 320,
    outstanding: 0,
  });
});
