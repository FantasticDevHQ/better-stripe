import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { creditPurchaseTerms } from "../../../src/client/usage/creditTerms";
import { request } from "../../../src/client/usage/subscription.fixtures";
import { modules } from "../../test";
import schema from "../schema";
import { api } from "../_generated/api";
import { productConfiguration } from "./policy";
const state = vi.hoisted(() => ({ meter: {} as object }));
const usage = vi.hoisted(() => ({
  purchaseCredits: vi.fn(),
  observeCreditPurchase: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: { usage } }));
vi.mock("./payment", () => ({
  paidEnrollment: async () => ({ meter: state.meter }),
}));
vi.mock("../stripe/client", () => ({
  getStripeClient: () => ({
    paymentIntents: {
      retrieve: async () => ({ status: "succeeded" }),
    },
  }),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("passes exact credit purchase terms through the real strict package contract and retains purchase identity", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  const configuration = productConfiguration("prepaid", "Reports");
  state.meter = {
    ...request.meters[0],
    binding: { ...request.meters[0].binding, plan: configuration.plan },
    subscription: {
      subscriptionId: "sub_reports",
      subscriptionItemId: "si_reports",
      period: { start: 1, end: 2 },
    },
  };
  usage.purchaseCredits.mockImplementation(async (_ctx, input) => {
    const terms = creditPurchaseTerms(input);
    expect(terms.quantity).toBe("10");
    return { purchase: { paymentIntentId: "pi_original" } };
  });
  usage.observeCreditPurchase.mockResolvedValue({ state: "ready" });
  const t = convexTest(schema, modules);
  const ref = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    });
    const actorId = await ctx.db.insert("users", {
      name: "Buyer",
      email: "buyer@example.com",
      role: "customer",
    });
    const offerId = await ctx.db.insert("meteredProductOffers", {
      ownerId,
      productId: "prod_reports",
      productName: "Reports",
      configurationJson: JSON.stringify(configuration),
      baseAmount: 0,
      createdAt: 1,
    });
    const enrollmentId = await ctx.db.insert("meteredProductEnrollments", {
      buyerId: actorId,
      offerId,
      createdAt: 1,
    });
    return { actorId, enrollmentId, requestId: "original-payment" };
  });
  expect(
    JSON.parse(await t.action(api.meteredProducts.funding.purchase, ref)).state,
  ).toBe("ready");
  await t.action(api.meteredProducts.funding.purchase, ref);
  expect(usage.purchaseCredits.mock.calls[0][1]).toEqual(
    usage.purchaseCredits.mock.calls[1][1],
  );
  expect(
    await t.run((ctx) => ctx.db.query("meteredProductPurchases").collect()),
  ).toHaveLength(1);
});
