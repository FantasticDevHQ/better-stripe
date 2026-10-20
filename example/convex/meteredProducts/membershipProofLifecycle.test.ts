import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { productConfiguration } from "./policy";
const mocks = vi.hoisted(() => ({
  stripe: { createAccount: vi.fn(), updateV2Account: vi.fn() },
  raw: {
    testHelpers: { testClocks: { create: vi.fn(), retrieve: vi.fn() } },
    v2: { core: { accounts: { retrieve: vi.fn() } } },
    checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  },
  checkout: vi.fn(),
  original: vi.fn(),
  observe: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: mocks.stripe }));
vi.mock("../stripe/client", () => ({ getStripeClient: () => mocks.raw }));
// Billing/enrollment behavior has its own native and action tests. This boundary
// keeps fixture isolation failures from performing a real Checkout in unit tests.
vi.mock("./native", async () => {
  const { action } = await import("../_generated/server");
  const { v } = await import("convex/values");
  return {
    originalEnrollment: mocks.original,
    observeEnrollment: mocks.observe,
    checkout: action({
      args: { actorId: v.id("users"), offerId: v.id("meteredProductOffers") },
      returns: v.string(),
      handler: (_ctx, args) => mocks.checkout(args),
    }),
  };
});
const runId = "mixed-proof-maya-lifecycle";
const clock = {
  id: "clock_owned",
  name: `mixed-proof:${runId}`,
  livemode: false,
};
const account = {
  id: "acct_owned",
  livemode: false,
  metadata: { bsMixedProof: runId },
  configuration: { customer: { test_clock: clock.id } },
};
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  mocks.raw.testHelpers.testClocks.create.mockResolvedValue(clock);
  mocks.raw.testHelpers.testClocks.retrieve.mockResolvedValue(clock);
  mocks.raw.v2.core.accounts.retrieve.mockResolvedValue(account);
  mocks.stripe.createAccount.mockResolvedValue({ stripeAccountId: account.id });
  mocks.stripe.updateV2Account.mockResolvedValue({});
  mocks.checkout.mockResolvedValue(
    JSON.stringify({
      status: "open",
      url: "https://checkout.stripe.com/test-only",
      enrollmentId: "original-enrollment",
    }),
  );
  mocks.raw.checkout.sessions.retrieve.mockResolvedValue({
    id: "cs_owned",
    status: "complete",
    customer_account: account.id,
    subscription: { id: "sub_owned" },
  });
  mocks.raw.subscriptions.retrieve.mockResolvedValue({
    id: "sub_owned",
    customer_account: account.id,
    livemode: false,
    latest_invoice: { id: "in_owned" },
    default_payment_method: { id: "pm_owned" },
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_maya",
    }),
  );
  const offerId = await t.run((ctx) =>
    ctx.db.insert("meteredProductOffers", {
      ownerId,
      productId: "prod_original",
      productName: "Maya membership",
      baseAmount: 2000,
      createdAt: Date.now(),
      configurationJson: JSON.stringify(
        productConfiguration("included_overage", "Maya membership"),
      ),
      providerJson: "{}",
    }),
  );
  const args = {
    runId,
    start: Math.floor(Date.now() / 1000) - 60,
    ownerId,
    offerId,
  };
  const prepared = JSON.parse(
    await t.action(internal.meteredProducts.membershipProof.prepare, args),
  );
  const ref = {
    runId,
    actorId: prepared.actorId,
    enrollmentId: await t.run((ctx) =>
      ctx.db.insert("meteredProductEnrollments", {
        buyerId: prepared.actorId,
        offerId,
        createdAt: Date.now(),
      }),
    ),
    clockId: clock.id,
  };
  const offer = await t.run((ctx) =>
    ctx.db.get("meteredProductOffers", offerId),
  );
  mocks.original.mockResolvedValue({
    offer,
    enrollment: { checkoutJson: JSON.stringify({ id: "cs_owned" }) },
    payer: { accountId: account.id },
  });
  mocks.observe.mockResolvedValue({
    offer,
    provider: { basePriceId: "price_base" },
    subscription: {
      subscriptionId: "sub_owned",
      items: [{ id: "si_base", stripePriceId: "price_base" }],
    },
    meter: {
      scope: { customerAccount: account.id },
      subscription: { period: { start: 100, end: 200 } },
    },
  });
  return { t, args, ref, offerId, prepared };
}
it("prepares one hidden buyer and resumes the original product Checkout without replacing shared catalog terms", async () => {
  const f = await setup();
  const replay = JSON.parse(
    await f.t.action(internal.meteredProducts.membershipProof.prepare, f.args),
  );
  expect(replay.actorId).toBe(f.prepared.actorId);
  expect(mocks.stripe.createAccount).toHaveBeenCalledTimes(1);
  expect(mocks.stripe.updateV2Account).toHaveBeenCalledWith(expect.anything(), {
    stripeAccountId: account.id,
    updateParams: { configuration: { customer: { test_clock: clock.id } } },
  });
  expect(mocks.checkout).toHaveBeenLastCalledWith({
    actorId: f.prepared.actorId,
    offerId: f.offerId,
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("meteredProductOffers", f.offerId)),
  ).toMatchObject({ productId: "prod_original", baseAmount: 2000 });
  mocks.raw.testHelpers.testClocks.create.mockClear();
  await f.t.run((ctx) =>
    ctx.db.patch("meteredProductOffers", f.offerId, { baseAmount: 2100 }),
  );
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.prepare, f.args),
  ).rejects.toThrow(/original USD20/);
  expect(mocks.raw.testHelpers.testClocks.create).not.toHaveBeenCalled();
});
it("requires native clock ownership before reconciling Checkout and retains original terms in the diagnostic proof", async () => {
  const f = await setup();
  mocks.checkout.mockClear();
  const proof = JSON.parse(
    await f.t.action(internal.meteredProducts.membershipProof.inspect, f.ref),
  );
  expect(proof).toMatchObject({
    productId: "prod_original",
    sellerAccountId: "acct_maya",
    invoiceId: "in_owned",
    input: {
      fixedPrice: {
        stripePriceId: "price_base",
        subscriptionItemId: "si_base",
        unitAmount: 2000,
      },
    },
  });
  expect(mocks.checkout).toHaveBeenCalledTimes(1);
  mocks.checkout.mockClear();
  mocks.raw.v2.core.accounts.retrieve.mockResolvedValue({
    ...account,
    configuration: { customer: { test_clock: "clock_foreign" } },
  });
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.inspect, f.ref),
  ).rejects.toThrow(/isolated account/);
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it("expires only the original unpaid fixture Checkout and treats expired retries as complete", async () => {
  const f = await setup();
  mocks.raw.checkout.sessions.retrieve.mockResolvedValue({
    id: "cs_owned",
    status: "open",
    customer_account: account.id,
  });
  expect(
    await f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).toBe("unpaid_fixture_checkout_expired");
  expect(mocks.raw.checkout.sessions.expire).toHaveBeenCalledWith("cs_owned");
  mocks.raw.checkout.sessions.retrieve.mockResolvedValue({
    id: "cs_owned",
    status: "expired",
    customer_account: account.id,
  });
  expect(
    await f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).toBe("unpaid_fixture_checkout_expired");
  expect(mocks.raw.checkout.sessions.expire).toHaveBeenCalledTimes(1);
  mocks.raw.checkout.sessions.retrieve.mockResolvedValue({
    id: "cs_foreign",
    status: "open",
    customer_account: "acct_alex",
  });
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).rejects.toThrow(/checkout payer/);
  expect(mocks.raw.checkout.sessions.expire).toHaveBeenCalledTimes(1);
});
it("cancels only the fixture's future renewal and holds substituted subscription ownership", async () => {
  const f = await setup();
  expect(
    await f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).toBe("fixture_renewal_cancelled_history_retained");
  expect(mocks.raw.subscriptions.update).toHaveBeenCalledWith("sub_owned", {
    cancel_at_period_end: true,
  });
  mocks.raw.subscriptions.update.mockClear();
  mocks.raw.subscriptions.retrieve.mockResolvedValue({
    id: "sub_owned",
    customer_account: "acct_alex",
    livemode: false,
  });
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).rejects.toThrow(/subscription payer/);
  expect(mocks.raw.subscriptions.update).not.toHaveBeenCalled();
  mocks.raw.v2.core.accounts.retrieve.mockResolvedValue({
    ...account,
    livemode: true,
  });
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.cleanup, f.ref),
  ).rejects.toThrow(/isolated account/);
  expect(mocks.raw.subscriptions.update).not.toHaveBeenCalled();
});
