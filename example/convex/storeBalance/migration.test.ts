// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { modules, schema } from "../../test";
import {
  modules as componentModules,
  schema as componentSchema,
} from "../../../src/test";
import { components, internal } from "../_generated/api";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(
    `storeBalance/funding/internal/migration:${name}`,
  );
async function fixture(pending = false) {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_original",
      storePlan: {
        planId: "growth",
        stripeSubscriptionId: "sub_original",
        status: "active",
        paidThrough: 9999999999999,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const fundingId = await t.run((ctx) =>
    ctx.db.insert("storeBalanceFunding", {
      sellerId,
      subscriptionId: "sub_original",
      enabled: false,
      paymentMethodId: "pm_balance",
      previousPaymentMethodId: "pm_card",
      previousPaymentMethodTypes: [],
      consentAt: 123,
      operationVersion: 7,
      operationPending: pending,
      ...(pending ? { targetEnabled: true } : {}),
    }),
  );
  const pause = () => t.mutation(mutation("pause"), { sellerId });
  const importRow = async (snapshot?: string) => {
    const paused = await pause();
    return t.mutation(mutation("importRecord"), {
      fundingId,
      accountId: "acct_original",
      subscriptionId: "sub_original",
      snapshot: snapshot ?? paused.snapshot,
    });
  };
  return { t, sellerId, fundingId, pause, importRow };
}

it("imports original restoration and version once without retiring the host row", async () => {
  const f = await fixture();
  const first = await f.importRow();
  expect(await f.importRow()).toEqual(first);
  const saved = await f.t.query(
    components.betterStripe.balanceFunding.queries.readPreparation,
    {
      accountId: "acct_original",
      scopeKey: first.scopeKey,
      preparationId: first.preparationId,
      stripeSubscriptionId: "sub_original",
    },
  );
  expect(saved).toMatchObject({
    enabled: false,
    startsPaused: true,
    operationVersion: 7,
    consentAt: 123,
    preparation: {
      paymentMethodId: "pm_balance",
      previousPaymentMethodId: "pm_card",
      previousPaymentMethodTypes: [],
    },
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceFunding", f.fundingId)),
  ).toMatchObject({
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    consentAt: 123,
  });
});

it("preserves pending legacy keys as unknown and prevents activation or legacy restart", async () => {
  const f = await fixture(true);
  const saved = await f.importRow();
  const operation = await f.t.query(
    components.betterStripe.balanceFunding.queries.inspectOperation,
    {
      ...saved.operation,
      stripeSubscriptionId: "sub_original",
    },
  );
  expect(operation).toMatchObject({
    state: "unknown",
    version: 7,
    providerKey: "example_balance_sub_original_7",
    providerKeys: {
      enable: "example_balance_sub_original_7:enable",
      disable: "example_balance_sub_original_7:disable",
    },
  });
  expect(operation?.execution).toBeUndefined();
  await expect(
    f.t.mutation(mutation("activate"), { fundingId: f.fundingId }),
  ).rejects.toThrow(/pending|reconcil/i);
  await expect(
    f.t.mutation(internal.storeBalance.funding.internal.mutations.begin, {
      sellerId: f.sellerId,
      enabled: true,
      consent: true,
    }),
  ).rejects.toThrow(/paused|migrat/i);
});

it("rejects a changed source after its snapshot and rolls back component import", async () => {
  const f = await fixture();
  const paused = await f.pause();
  await f.t.run((ctx) =>
    ctx.db.patch("storeBalanceFunding", f.fundingId, {
      previousPaymentMethodId: "pm_changed",
    }),
  );
  await expect(f.importRow(paused.snapshot)).rejects.toThrow(
    /snapshot|changed/i,
  );
  expect(
    await f.t.query(
      components.betterStripe.balanceFunding.queries.readScopePreparation,
      {
        accountId: "acct_original",
        scopeKey: `example:store-balance:${f.sellerId}:sub_original`,
        stripeSubscriptionId: "sub_original",
        providerApiVersion: "2026-09-30.preview",
      },
    ),
  ).toBeNull();
});

it("does not remap historical restoration onto a replacement account or subscription", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch("users", f.sellerId, { stripeAccountId: "acct_replacement" }),
  );
  await expect(f.importRow()).rejects.toThrow(/identity|belong|account/i);
});

it("rechecks the seller binding at activation after a successful import", async () => {
  const f = await fixture();
  await f.importRow();
  await f.t.run((ctx) =>
    ctx.db.patch("users", f.sellerId, { stripeAccountId: "acct_replacement" }),
  );
  await expect(
    f.t.mutation(mutation("activate"), { fundingId: f.fundingId }),
  ).rejects.toThrow(/identity|account/i);
});

it("refuses pending history without its original version", async () => {
  const f = await fixture(true);
  await f.t.run((ctx) =>
    ctx.db.patch("storeBalanceFunding", f.fundingId, {
      operationVersion: undefined,
    }),
  );
  await expect(f.importRow()).rejects.toThrow(/version/i);
});

it("can roll back an unchanged import without enabling both writers", async () => {
  const f = await fixture();
  const saved = await f.importRow();
  await f.t.mutation(mutation("activate"), { fundingId: f.fundingId });
  await f.t.mutation(mutation("rollback"), { fundingId: f.fundingId });
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceFunding", f.fundingId)),
  ).toMatchObject({ migrationPaused: false });
  expect(
    (
      await f.t.query(
        components.betterStripe.balanceFunding.queries.readPreparation,
        {
          accountId: "acct_original",
          scopeKey: saved.scopeKey,
          preparationId: saved.preparationId,
          stripeSubscriptionId: "sub_original",
        },
      )
    )?.startsPaused,
  ).toBe(true);
});

it("reconciles an imported pending receipt without starting another provider operation", async () => {
  const f = await fixture(true);
  const saved = await f.importRow();
  await f.t.mutation(components.betterStripe.balanceFunding.mutations.finish, {
    ...saved.operation,
    enabled: true,
    receipt: {
      customerAccount: "acct_original",
      stripeSubscriptionId: "sub_original",
      paymentMethodId: "pm_balance",
      paymentMethodTypes: ["stripe_balance"],
      providerApiVersion: "2026-09-30.preview",
    },
  });
  await f.t.mutation(mutation("activate"), { fundingId: f.fundingId });
  await expect(
    f.t.mutation(mutation("rollback"), { fundingId: f.fundingId }),
  ).rejects.toThrow(/history|reconcil/i);
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceFunding", f.fundingId)),
  ).toMatchObject({
    enabled: false,
    operationPending: true,
    migrationPaused: true,
    componentMigration: { state: "active" },
  });
});

it("holds rollback after any new component operation, even when the source row is retained", async () => {
  const f = await fixture();
  const saved = await f.importRow();
  await f.t.mutation(mutation("activate"), { fundingId: f.fundingId });
  await f.t.mutation(components.betterStripe.balanceFunding.mutations.begin, {
    accountId: "acct_original",
    scopeKey: saved.scopeKey,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "new-component-intent",
  });
  await expect(
    f.t.mutation(mutation("rollback"), { fundingId: f.fundingId }),
  ).rejects.toThrow(/history|reconcil/i);
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceFunding", f.fundingId)),
  ).toMatchObject({ migrationPaused: true });
});

it("reserves bounded pages, fences legacy starts, and acknowledges each page once", async () => {
  const f = await fixture();
  for (let i = 0; i < 13; i++) {
    await f.t.run((ctx) =>
      ctx.db.insert("storeBalanceFunding", {
        sellerId: f.sellerId,
        subscriptionId: `sub_historical_${i}`,
        enabled: false,
        paymentMethodId: `pm_historical_${i}`,
        consentAt: i,
      }),
    );
  }
  const refs = internal.storeBalance.backfill.mutations;
  const runId = await f.t.mutation(refs.start, {});
  await expect(
    f.t.mutation(internal.storeBalance.funding.internal.mutations.begin, {
      sellerId: f.sellerId,
      enabled: true,
      consent: true,
    }),
  ).rejects.toThrow(/fenced/);
  const first = await f.t.mutation(refs.reserve, { runId });
  expect(first.page?.ids).toHaveLength(10);
  expect(await f.t.mutation(refs.reserve, { runId })).toEqual(first);
  const checkpoint = await f.t.mutation(refs.checkpoint, {
    runId,
    cursor: first.cursor,
  });
  expect(checkpoint).toMatchObject({
    scanned: 10,
    active: 0,
    held: 10,
    state: "running",
  });
  expect(
    await f.t.mutation(refs.checkpoint, { runId, cursor: first.cursor }),
  ).toEqual(checkpoint);
  const second = await f.t.mutation(refs.reserve, { runId });
  expect(second.page?.ids).toHaveLength(4);
  const done = await f.t.mutation(refs.checkpoint, {
    runId,
    cursor: second.cursor,
  });
  expect(done).toMatchObject({
    scanned: 14,
    active: 0,
    held: 14,
    state: "held",
  });
  expect(await f.t.mutation(refs.start, {})).toBe(runId);
  await f.t.mutation(refs.start, { rescan: true });
  expect(
    await f.t.query(internal.storeBalance.backfill.queries.state, { runId }),
  ).toMatchObject({ scanned: 0, held: 0, state: "running", cursor: null });
});
it("counts active imports from verified component state and retains their source", async () => {
  const f = await fixture();
  await f.importRow();
  await f.t.mutation(mutation("activate"), { fundingId: f.fundingId });
  const refs = internal.storeBalance.backfill.mutations;
  const runId = await f.t.mutation(refs.start, {});
  const page = await f.t.mutation(refs.reserve, { runId });
  expect(
    await f.t.mutation(refs.checkpoint, { runId, cursor: page.cursor }),
  ).toMatchObject({ scanned: 1, active: 1, held: 0, state: "verified" });
  await expect(
    f.t.mutation(mutation("rollback"), { fundingId: f.fundingId }),
  ).rejects.toThrow(/Global cutover/);
  expect(
    await f.t.run((ctx) => ctx.db.get("storeBalanceFunding", f.fundingId)),
  ).not.toBeNull();
});
