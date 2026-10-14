// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  invoices: { list: vi.fn() },
  transfers: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");
beforeEach(() => {
  vi.resetAllMocks();
  raw.transfers.list.mockResolvedValue({ data: [] });
  raw.transfers.create.mockImplementation(async (args) => ({
    id: `tr_${args.destination}`,
    ...args,
  }));
});
async function setup(
  planId: "starter" | "growth" | "pro",
  referred = false,
  fee: number | null = 320,
) {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
      storePlan: {
        planId,
        status: "active",
        paidThrough: Date.now() + 86400000,
        stripeSubscriptionId: "sub_store",
        cancelAtPeriodEnd: false,
      },
    }),
  );
  if (referred)
    await t.run((ctx) =>
      ctx.db.insert("affiliateDefaults", {
        affiliateBasisPoints: 2000,
        affiliateFixedAmount: null,
        version: 1,
      }),
    );
  const payment = {
    id: "pi_sale",
    status: "succeeded",
    amount_received: 10000,
    currency: "usd",
    metadata: {
      storeBilling: "sale_v1",
      sellerId,
      planId,
      userId: "customer",
      affiliateAccountId: referred ? "acct_affiliate" : "",
    },
    latest_charge: {
      id: "ch_sale",
      amount_refunded: 0,
      balance_transaction: fee === null ? null : { currency: "usd", fee },
    },
  };
  raw.paymentIntents.retrieve.mockResolvedValue(payment);
  return { t, sellerId, payment };
}
it.each([
  ["one_time", 0],
  ["forever", 1820],
] as const)(
  "%s commission survives retries and pays the correct renewal",
  async (term, renewalCommission) => {
    const { t, sellerId, payment } = await setup("starter", true);
    raw.invoices.list.mockResolvedValue({
      data: [
        {
          id: "in_first",
          amount_paid: 10000,
          status_transitions: { paid_at: 1 },
        },
      ],
      has_more: false,
    });
    raw.subscriptions.retrieve.mockResolvedValue({
      metadata: { ...payment.metadata, affiliateCommissionTerm: term },
    });
    const settle = (invoiceId: string, paymentIntentId: string) =>
      t.action(internal.storeSaleSettlement.settle, {
        paymentIntentId,
        subscriptionId: "sub_term",
        invoiceId,
      });
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      status: "requires_payment_method",
    });
    await settle("in_first", "pi_sale");
    expect(raw.transfers.create).not.toHaveBeenCalled();
    raw.paymentIntents.retrieve.mockResolvedValue(payment);
    await settle("in_first", "pi_sale");
    await settle("in_first", "pi_sale");
    expect(
      (
        await t.query(internal.storeSaleSettlement.getByCharge, {
          chargeId: "ch_sale",
        })
      )?.affiliateNet,
    ).toBe(1820);
    raw.subscriptions.retrieve.mockResolvedValue({
      metadata: {
        ...payment.metadata,
        affiliateCommissionTerm: term === "one_time" ? "forever" : "one_time",
      },
    });
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      id: "pi_renewal",
      latest_charge: { ...payment.latest_charge, id: "ch_renewal" },
    });
    await settle("in_renewal", "pi_renewal");
    await settle("in_renewal", "pi_renewal");
    const sale = await t.query(internal.storeSaleSettlement.getByCharge, {
      chargeId: "ch_renewal",
    });
    expect(sale).toMatchObject({
      affiliateNet: renewalCommission,
      sellerNet: 9100 - renewalCommission,
      affiliateCommissionTerm: term,
      stripeSubscriptionId: "sub_term",
    });
    expect(raw.transfers.create).toHaveBeenCalledTimes(
      term === "one_time" ? 3 : 4,
    );
    expect(raw.invoices.list).toHaveBeenCalledTimes(
      term === "one_time" ? 1 : 0,
    );
    expect(
      await t.query(api.storeSaleSettlement.listSellerSales, { sellerId }),
    ).toHaveLength(2);
  },
);

it("does not give a delayed renewal the one-time commission before the first invoice webhook arrives", async () => {
  const { t, payment } = await setup("starter", true);
  raw.subscriptions.retrieve.mockResolvedValue({
    metadata: { ...payment.metadata, affiliateCommissionTerm: "one_time" },
  });
  raw.invoices.list.mockResolvedValue({
    data: [
      {
        id: "in_renewal",
        amount_paid: 10000,
        status_transitions: { paid_at: 2 },
      },
      {
        id: "in_first",
        amount_paid: 10000,
        status_transitions: { paid_at: 1 },
      },
      { id: "in_trial", amount_paid: 0, status_transitions: { paid_at: 0 } },
    ],
    has_more: false,
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
    subscriptionId: "sub_delayed",
    invoiceId: "in_renewal",
  });
  expect(
    (
      await t.query(internal.storeSaleSettlement.getByCharge, {
        chargeId: "ch_sale",
      })
    )?.affiliateNet,
  ).toBe(0);
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    id: "pi_first",
    latest_charge: { ...payment.latest_charge, id: "ch_first" },
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_first",
    subscriptionId: "sub_delayed",
    invoiceId: "in_first",
  });
  expect(
    (
      await t.query(internal.storeSaleSettlement.getByCharge, {
        chargeId: "ch_first",
      })
    )?.affiliateNet,
  ).toBe(1820);
});
