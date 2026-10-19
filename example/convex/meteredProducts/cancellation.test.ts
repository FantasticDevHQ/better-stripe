import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
const usage = vi.hoisted(() => ({
  setCancelAtPeriodEnd: vi.fn(),
  observeSubscription: vi.fn(),
  ensureSubscription: vi.fn(),
  ensureCheckout: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: { usage } }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("pins a fresh cancellation observation instead of promoting an old idempotent command receipt", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  const t = convexTest(schema, modules);
  const { actorId, enrollmentId } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    });
    const actorId = await ctx.db.insert("users", {
      name: "Customer",
      email: "customer@example.com",
      role: "customer",
    });
    const offerId = await ctx.db.insert("meteredProductOffers", {
      ownerId,
      productId: "prod_reports",
      productName: "Reports",
      configurationJson: "{}",
      baseAmount: 0,
      createdAt: 1,
      providerJson: JSON.stringify({ issuer: "acct_platform" }),
    });
    const enrollmentId = await ctx.db.insert("meteredProductEnrollments", {
      buyerId: actorId,
      offerId,
      createdAt: 1,
      payerJson: JSON.stringify({ accountId: "acct_buyer" }),
    });
    return { actorId, enrollmentId };
  });
  usage.setCancelAtPeriodEnd.mockResolvedValue({
    status: "active",
    cancelAtPeriodEnd: true,
    items: [{ period: { start: 1, end: 2 } }],
  });
  const current = {
    status: "canceled",
    cancelAtPeriodEnd: false,
    items: [{ period: { start: 2, end: 3 } }],
  };
  usage.observeSubscription.mockResolvedValue(current);
  await t.action(api.meteredProducts.native.cancelRenewal, {
    actorId,
    enrollmentId,
  });
  const row = await t.query(internal.meteredProducts.enrollments.read, {
    actorId,
    enrollmentId,
  });
  expect(JSON.parse(row.providerJson!)).toEqual(current);
  expect(usage.observeSubscription).toHaveBeenCalledTimes(1);
});

it("enrolls prepaid products through the supported invoice collection policy, never automatic Checkout", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
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
    const provider = {
      issuer: "acct_platform",
      basePriceId: null,
      configuration: { plan: { model: "prepaid" }, eventName: "reports_v1" },
      price: { meterId: "mtr_reports", stripePriceId: "price_reports" },
    };
    const offerId = await ctx.db.insert("meteredProductOffers", {
      ownerId,
      productId: "prod_reports",
      productName: "Reports",
      configurationJson: "{}",
      baseAmount: 0,
      createdAt: 1,
      providerJson: JSON.stringify(provider),
    });
    const enrollmentId = await ctx.db.insert("meteredProductEnrollments", {
      buyerId: actorId,
      offerId,
      createdAt: 1,
      payerJson: JSON.stringify({
        accountId: "acct_buyer",
        customerId: "cus_buyer",
      }),
    });
    return { actorId, offerId, enrollmentId };
  });
  const subscription = { status: "active", bindings: [] };
  usage.ensureSubscription.mockResolvedValue(subscription);
  await t.action(api.meteredProducts.native.checkout, {
    actorId: fixture.actorId,
    offerId: fixture.offerId,
  });
  expect(usage.ensureSubscription).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      requestId: `product_${fixture.enrollmentId}`,
      collection: { method: "send_invoice", daysUntilDue: 30 },
    }),
    expect.anything(),
  );
  expect(usage.ensureCheckout).not.toHaveBeenCalled();
  const enrollment = await t.query(internal.meteredProducts.enrollments.read, {
    actorId: fixture.actorId,
    enrollmentId: fixture.enrollmentId,
  });
  expect(JSON.parse(enrollment.providerJson!)).toEqual(subscription);
});
