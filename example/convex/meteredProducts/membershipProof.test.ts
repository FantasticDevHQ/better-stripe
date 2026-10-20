import { afterEach, expect, it, vi } from "vitest";
import { activityFixture } from "../../testing/meteredActivity";
import { internal } from "../_generated/api";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("creates one isolated fixture buyer and never adopts an ordinary demo customer", async () => {
  const f = await activityFixture();
  const args = { runId: "mixed-proof-maya-e2e" };
  const buyer = await f.t.mutation(
    internal.meteredProducts.membershipProof.buyer,
    args,
  );
  expect(
    await f.t.mutation(internal.meteredProducts.membershipProof.buyer, args),
  ).toBe(buyer);
  expect(await f.t.run((ctx) => ctx.db.get("users", buyer))).toMatchObject({
    testFixture: true,
    role: "customer",
  });
  await expect(
    f.t.mutation(internal.meteredProducts.membershipProof.buyer, {
      runId: "alex",
    }),
  ).rejects.toThrow(/fixture/);
  await f.t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Existing customer",
      email: "mixed-proof-maya-conflict@example.invalid",
      role: "customer",
    }),
  );
  await expect(
    f.t.mutation(internal.meteredProducts.membershipProof.buyer, {
      runId: "mixed-proof-maya-conflict",
    }),
  ).rejects.toThrow(/ordinary/);
});
it("rejects a future clock before creating any native resources", async () => {
  const f = await activityFixture();
  const offerId = await f.t.run((ctx) =>
    ctx.db.insert("meteredProductOffers", {
      ownerId: f.actorId,
      productId: "prod_test",
      productName: "Test",
      configurationJson: "{}",
      baseAmount: 2000,
      createdAt: Date.now(),
    }),
  );
  await expect(
    f.t.action(internal.meteredProducts.membershipProof.prepare, {
      runId: "mixed-proof-maya-future",
      start: Math.floor(Date.now() / 1000) + 60,
      ownerId: f.actorId,
      offerId,
    }),
  ).rejects.toThrow(/current time/);
});
it("rejects a non-fixture buyer even when its email matches the fixture name", async () => {
  const f = await activityFixture();
  const actorId = await f.t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Ordinary",
      email: "mixed-proof-maya-identity@example.invalid",
      role: "customer",
    }),
  );
  await expect(
    f.t.query(internal.meteredProducts.membershipProof.readBuyer, {
      actorId,
      runId: "mixed-proof-maya-identity",
    }),
  ).rejects.toThrow(/isolated buyer/);
});
