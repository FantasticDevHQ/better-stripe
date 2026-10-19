import { afterEach, expect, it, vi } from "vitest";
import { activityFixture } from "../../testing/meteredActivity";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { productConfiguration } from "./policy";
import type { RunCtx } from "../../../src/client/helpers.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const f = await activityFixture();
  const providerJson = JSON.stringify({
    subscriptionId: f.meter.subscription.subscriptionId,
    status: "active",
    bindings: [f.meter],
  });
  const enrollmentId = await f.t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_maya",
    });
    const offerId = await ctx.db.insert("meteredProductOffers", {
      ownerId,
      providerJson: "{}",
      productId: "prod_coaching",
      productName: "Coaching",
      configurationJson: JSON.stringify(
        productConfiguration("included_overage", "Coaching"),
      ),
      baseAmount: 2000,
      createdAt: Date.now(),
    });
    return ctx.db.insert("meteredProductEnrollments", {
      payerJson: "{}",
      buyerId: f.actorId,
      offerId,
      createdAt: Date.now(),
      providerJson,
    });
  });
  return { ...f, enrollmentId, providerJson };
}
it("records coaching minutes once with the package ledger and rejects a different replay quantity", async () => {
  const f = await fixture();
  const args = {
    actorId: f.actorId,
    enrollmentId: f.enrollmentId,
    verifiedProviderJson: f.providerJson,
    requestId: "call-1",
    quantity: "5",
  };
  expect(
    JSON.parse(await f.t.mutation(internal.meteredProducts.work.accept, args))
      .work,
  ).toBe("completed_once");
  expect(
    JSON.parse(await f.t.mutation(internal.meteredProducts.work.accept, args))
      .work,
  ).toBe("already_completed");
  await expect(
    f.t.mutation(internal.meteredProducts.work.accept, {
      ...args,
      quantity: "6",
    }),
  ).rejects.toThrow(/original session/);
  const summary = await f.t.action((ctx) =>
    stripe.usage.getSummary(ctx as RunCtx, {
      scope: f.meter.scope,
      period: f.meter.subscription.period,
    }),
  );
  expect(summary.eventCount).toBe(1);
  expect(summary.groups[0].acceptedQuantity).toBe("5");
});
it("rejects an observation changed between payment verification and the atomic work transaction", async () => {
  const f = await fixture();
  await expect(
    f.t.mutation(internal.meteredProducts.work.accept, {
      actorId: f.actorId,
      enrollmentId: f.enrollmentId,
      verifiedProviderJson: JSON.stringify({ differentPeriod: true }),
      requestId: "call-race",
      quantity: "5",
    }),
  ).rejects.toThrow(/verified billing period/);
  expect(
    await f.t.run((ctx) => ctx.db.query("coachingSessions").take(1)),
  ).toEqual([]);
});
it("retains purchased product history after store access is disabled", async () => {
  const f = await fixture();
  const enrollment = await f.t.query(
    internal.meteredProducts.enrollments.read,
    { actorId: f.actorId, enrollmentId: f.enrollmentId },
  );
  const offer = await f.t.query(internal.meteredProducts.catalog.read, {
    actorId: f.actorId,
    offerId: enrollment.offerId,
  });
  await f.t.run((ctx) =>
    ctx.db.insert("meteredStoreSettings", {
      sellerId: offer.ownerId,
      enabled: false,
    }),
  );
  const { api } = await import("../_generated/api");
  expect(
    (
      await f.t.query(api.meteredProducts.catalog.list, { actorId: f.actorId })
    ).map((row) => row._id),
  ).toContain(offer._id);
});
it("loads a paginated original history without forwarding page fields into authorization queries", async () => {
  const f = await fixture();
  const { api } = await import("../_generated/api");
  const page = JSON.parse(
    await f.t.action(api.meteredProducts.readers.history, {
      actorId: f.actorId,
      enrollmentId: f.enrollmentId,
      limit: 25,
      cursor: null,
    }),
  );
  expect(page.status).toBe("available");
  expect(page.value.records).toEqual([]);
});
