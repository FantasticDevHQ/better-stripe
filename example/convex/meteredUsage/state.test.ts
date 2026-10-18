import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { internal } from "../_generated/api";
import * as state from "./state";
import { demoConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const [actorId, foreignId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", {
        name: "Usage test",
        email: "usage@example.invalid",
        role: "customer",
      }),
      ctx.db.insert("users", {
        name: "Foreign test",
        email: "foreign@example.invalid",
        role: "customer",
      }),
    ]),
  );
  return { t, actorId, foreignId };
}
it("persists one repeatable server run per actor/model and retains configuration on retries", async () => {
  expect(state.begin).toBeTypeOf("function");
  const { t, actorId } = await setup();
  const args = {
    actorId,
    model: "pay_as_you_go" as const,
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  };
  const first = await t.mutation(internal.meteredUsage.state.begin, args);
  const second = await t.mutation(internal.meteredUsage.state.begin, args);
  expect(second).toEqual(first);
  const changed = demoConfiguration("pay_as_you_go");
  changed.plan.version = "v2";
  await expect(
    t.mutation(internal.meteredUsage.state.begin, {
      ...args,
      configurationJson: JSON.stringify(changed),
    }),
  ).rejects.toThrow(/original configuration/);
});
it("rejects foreign run/resource access and live-key operation before writes", async () => {
  expect(state.begin).toBeTypeOf("function");
  const { t, actorId, foreignId } = await setup();
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "prepaid",
    configurationJson: JSON.stringify(demoConfiguration("prepaid")),
  });
  await expect(
    t.query(internal.meteredUsage.state.read, { actorId: foreignId, runId }),
  ).rejects.toThrow(/not available/);
  await expect(
    t.mutation(internal.meteredUsage.state.prepareResource, {
      actorId: foreignId,
      runId,
      kind: "clock",
    }),
  ).rejects.toThrow(/not available/);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_disallowed");
  await expect(
    t.query(internal.meteredUsage.state.read, { actorId, runId }),
  ).rejects.toThrow(/test/i);
});
it("pins provider identity with a retained first-attempt time and never replaces it", async () => {
  expect(state.prepareResource).toBeTypeOf("function");
  const { t, actorId } = await setup();
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "pay_as_you_go",
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  });
  const ref = { actorId, runId, kind: "clock" };
  const intent = await t.mutation(
    internal.meteredUsage.state.prepareResource,
    ref,
  );
  await t.mutation(internal.meteredUsage.state.pinResource, {
    ...ref,
    stripeId: "clock_original",
  });
  const later = await t.mutation(
    internal.meteredUsage.state.prepareResource,
    ref,
  );
  expect(later.createdAt).toBe(intent.createdAt);
  expect(later.stripeId).toBe("clock_original");
  await expect(
    t.mutation(internal.meteredUsage.state.pinResource, {
      ...ref,
      stripeId: "clock_other",
    }),
  ).rejects.toThrow(/identity/);
});
it("retains original synthetic work quantity/time on replay and rejects a conflicting reuse", async () => {
  expect(state.activity).toBeTypeOf("function");
  const { t, actorId } = await setup();
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "included_overage",
    configurationJson: JSON.stringify(demoConfiguration("included_overage")),
  });
  const args = { actorId, runId, requestId: "work-1", quantity: "5" };
  const first = await t.mutation(internal.meteredUsage.state.activity, args);
  expect(await t.mutation(internal.meteredUsage.state.activity, args)).toEqual(
    first,
  );
  await expect(
    t.mutation(internal.meteredUsage.state.activity, {
      ...args,
      quantity: "6",
    }),
  ).rejects.toThrow(/original work/);
  const result = await t.query(internal.meteredUsage.state.read, {
    actorId,
    runId,
  });
  expect(result.lastActivityId).toBe(first._id);
});
it("binds a real authenticated identity when present instead of accepting another demo persona", async () => {
  const { t, actorId } = await setup();
  await t.run((ctx) =>
    ctx.db.patch("users", actorId, {
      authTokenIdentifier: "https://issuer.test|owner",
    }),
  );
  const args = {
    actorId,
    model: "pay_as_you_go" as const,
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  };
  const owner = t.withIdentity({
    tokenIdentifier: "https://issuer.test|owner",
  });
  const intruder = t.withIdentity({
    tokenIdentifier: "https://issuer.test|other",
  });
  expect(
    await owner.mutation(internal.meteredUsage.state.begin, args),
  ).toBeTruthy();
  await expect(
    intruder.mutation(internal.meteredUsage.state.begin, args),
  ).rejects.toThrow(/not available/);
});
it("freezes new work for closeout while retaining original intent retries", async () => {
  expect(state.freezeBilling).toBeTypeOf("function");
  const { t, actorId } = await setup();
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "pay_as_you_go",
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  });
  const work = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "original",
    quantity: "5",
  });
  await t.mutation(internal.meteredUsage.state.freezeBilling, {
    actorId,
    runId,
  });
  expect(
    await t.mutation(internal.meteredUsage.state.activity, {
      actorId,
      runId,
      requestId: "original",
      quantity: "5",
    }),
  ).toEqual(work);
  await expect(
    t.mutation(internal.meteredUsage.state.activity, {
      actorId,
      runId,
      requestId: "new-work",
      quantity: "5",
    }),
  ).rejects.toThrow(/billing period is closing/);
});
it("pins server-owned seller and affiliate fixture policy at setup instead of accepting browser routing", async () => {
  const { t } = await setup();
  const sellerId = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      name: "Affiliate",
      email: "affiliate@example.invalid",
      role: "affiliate",
      stripeAccountId: "acct_affiliate",
    });
    return ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.invalid",
      role: "seller",
      stripeAccountId: "acct_seller",
    });
  });
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId: sellerId,
    model: "pay_as_you_go",
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  });
  const run = await t.query(internal.meteredUsage.state.read, {
    actorId: sellerId,
    runId,
  });
  expect(JSON.parse(run.settlementPolicyJson!)).toMatchObject({
    creatorAccountId: "acct_seller",
    affiliate: { destinationAccountId: "acct_affiliate", basisPoints: 2000 },
    commissionTerm: "forever",
  });
  await t.run((ctx) =>
    ctx.db.patch("users", sellerId, { stripeAccountId: "acct_changed" }),
  );
  expect(
    (
      await t.query(internal.meteredUsage.state.read, {
        actorId: sellerId,
        runId,
      })
    ).settlementPolicyJson,
  ).toBe(run.settlementPolicyJson);
});
