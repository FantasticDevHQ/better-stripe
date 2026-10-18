import Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const methods = vi.hoisted(() => ({
  getInvoiceSale: vi.fn(),
  settleInvoice: vi.fn(),
  getCreditPurchaseRevenue: vi.fn(),
  settleCreditPurchase: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: { usage: methods } }));
vi.mock("../_generated/server", () => ({
  env: { STRIPE_SECRET_KEY: "sk_test_transport" },
}));
import { observeDemoRevenue } from "./revenue";
import { refreshDemoCleanupEvidence } from "./cleanupRefresh";
import type { ActionCtx } from "../_generated/server";
import type { freezeDemoBilling } from "./billingPreflight";
function original(model = "payg") {
  return {
    run: {
      model,
      settlementPolicyJson: JSON.stringify({
        feeBasisPoints: 1000,
        creatorAccountId: "acct_seller",
        commissionTerm: "forever",
      }),
    },
    meter: {
      scope: { meterId: "m_original" },
      binding: {},
      subscription: { period: { start: 100, end: 200 } },
    },
    purchases: [{ _id: "purchase_original", quantity: "10" }],
  } as unknown as Awaited<ReturnType<typeof freezeDemoBilling>>;
}
const invoice = {
  id: "in_original",
  status: "paid",
  amount_paid: 1500,
} as Stripe.Invoice;
const saved = {
  status: "paid",
  invoiceId: invoice.id,
  revenue: [{ cash: { status: "ready" }, settlement: { status: "settled" } }],
};
function client(hasMore = false) {
  return new Stripe("sk_test_transport", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(
      async () =>
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "inpay_original",
                status: "paid",
                payment: {
                  type: "payment_intent",
                  payment_intent: "pi_original",
                },
              },
            ],
            has_more: hasMore,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
});
it.each(["payg", "included"])(
  "refreshes the exact %s original payment through the real SDK before cleanup",
  async (model) => {
    methods.getInvoiceSale.mockResolvedValue({ status: "ready" });
    methods.settleInvoice.mockResolvedValue({
      status: "settled",
      executedTransfers: [{ id: "tr_original" }],
    });
    const read = async () => ({
      ...saved,
      ...(await observeDemoRevenue(
        {} as ActionCtx,
        client(),
        original(model),
        invoice,
      )),
    });
    await expect(
      refreshDemoCleanupEvidence(saved, read),
    ).resolves.toMatchObject({
      revenue: [{ settlement: { executedTransfers: [{ id: "tr_original" }] } }],
    });
    expect(methods.getInvoiceSale.mock.calls[0][1]).toMatchObject({
      invoiceId: "in_original",
      paymentIntentId: "pi_original",
      gross: 1500,
      period: { start: 100, end: 200 },
    });
    methods.getInvoiceSale.mockResolvedValue({
      status: "rejected",
      reason: "refunded_or_disputed",
    });
    await expect(refreshDemoCleanupEvidence(saved, read)).rejects.toThrow(
      /cash/i,
    );
    expect(methods.settleInvoice).toHaveBeenCalledTimes(1);
  },
);
it("holds incomplete native payment history instead of relying on saved readiness", async () => {
  await expect(
    refreshDemoCleanupEvidence(saved, async () => ({
      ...saved,
      ...(await observeDemoRevenue(
        {} as ActionCtx,
        client(true),
        original(),
        invoice,
      )),
    })),
  ).rejects.toThrow();
  expect(methods.getInvoiceSale).not.toHaveBeenCalled();
  expect(methods.settleInvoice).not.toHaveBeenCalled();
});
it("rechecks original prepaid purchase cash and holds failed settlement recovery", async () => {
  methods.getCreditPurchaseRevenue.mockResolvedValue({ status: "ready" });
  methods.settleCreditPurchase.mockRejectedValue(
    new Error("provider private detail"),
  );
  await expect(
    refreshDemoCleanupEvidence(saved, async () => ({
      ...saved,
      ...(await observeDemoRevenue(
        {} as ActionCtx,
        client(),
        original("prepaid"),
        { ...invoice, amount_paid: 0 },
      )),
    })),
  ).rejects.toThrow(/settlement/i);
  expect(methods.getCreditPurchaseRevenue.mock.calls[0][1]).toMatchObject({
    purchaseId: "purchase_original",
    quantity: "10",
  });
  expect(methods.getInvoiceSale).not.toHaveBeenCalled();
});
