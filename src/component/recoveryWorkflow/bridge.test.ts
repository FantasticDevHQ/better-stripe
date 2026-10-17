import {
  CostRecoveryClient,
  type RecoveryStartOptions,
} from "../../client/costRecovery.js";
import type { Component } from "../../client/helpers.js";
import { invoke } from "./bridge.js";
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import {
  anyApi,
  componentsGeneric,
  defineSchema,
  defineTable,
  internalActionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../test.js";
const nested = componentsGeneric();
const ref = (op: { operationId: string; version: number }) => ({
  ...scope,
  operationId: op.operationId,
  version: op.version,
});
const scope = {
  accountId: "acct_a",
  scopeKey: "seller",
  currency: "usd",
  groupKey: "group",
};
let calls: string[];
let result: unknown;
let providerGate: Promise<void> | null;
let callbackFailures = 0;
let loseProviderJournal = false;
const host = {
  completed: internalMutationGeneric({
    args: {
      ...Object.fromEntries(Object.keys(scope).map((k) => [k, v.string()])),
      operationId: v.string(),
      version: v.number(),
      sourceKind: v.string(),
      sourceId: v.string(),
      status: v.string(),
      cancelRequested: v.boolean(),
      outcome: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      if (callbackFailures-- > 0)
        throw new Error("private callback database detail");
      await ctx.db.insert("completions", {
        operationId: args.operationId,
        outcome: args.outcome,
      });
      return null;
    },
  }),
  provider: internalActionGeneric({
    args: {
      ...Object.fromEntries(Object.keys(scope).map((k) => [k, v.string()])),
      operationId: v.string(),
      version: v.number(),
      providerApiVersion: v.string(),
      definitionVersion: v.number(),
      phase: v.string(),
    },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls.push(args.phase);
      if (providerGate) await providerGate;
      if (result instanceof Error) throw result;
      return { ...args, sourceId: "in_a", ...(result as object) };
    },
  }),
  start: internalMutationGeneric({
    args: {},
    returns: v.any(),
    handler: async (ctx) =>
      new CostRecoveryClient(
        nested.betterStripe as unknown as Component,
      ).startGroup(ctx, {
        ...scope,
        requestKey: "request",
        provider: anyApi.host.provider as RecoveryStartOptions["provider"],
        completion: anyApi.host.completed as RecoveryStartOptions["completion"],
        providerApiVersion: "2026-09-30.endive",
        definitionVersion: 1,
        releaseUncollectible: false,
        maxAttempts: 2,
        retryDelayMs: 1,
      }),
  }),
};
async function fixture() {
  const t = convexTest(
    defineSchema({
      completions: defineTable({
        operationId: v.string(),
        outcome: v.string(),
      }),
    }),
    {
      "./_generated/api.ts": async () => ({}),
      "./host.ts": async () => host,
    },
  );
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/recoveryWorkflow/bridge.ts": async () => ({
      invoke: internalActionGeneric({
        args: {
          accountId: v.string(),
          scopeKey: v.string(),
          currency: v.string(),
          groupKey: v.string(),
          operationId: v.string(),
          version: v.number(),
          phase: v.union(v.literal("execute"), v.literal("reconcile")),
        },
        returns: v.any(),
        handler: async (ctx, args) => {
          const result = await (
            invoke as unknown as {
              _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
            }
          )._handler(ctx, args);
          if (loseProviderJournal) {
            loseProviderJournal = false;
            throw new Error("Provider journal unavailable");
          }
          return result;
        },
      }),
    }),
    "./component/fixture.ts": async () => ({
      largeGroup: internalMutationGeneric({
        args: {},
        handler: async (ctx) => {
          const group = (await ctx.db.query("recoveryGroups").first())!;
          for (let i = 0; i < 201; i++) {
            const claimKey = `claim:${i}`;
            const claimId = await ctx.db.insert("recoveryClaims", {
              accountId: scope.accountId,
              scopeKey: scope.scopeKey,
              currency: scope.currency,
              claimKey,
              sourceChargeId: `ch_${i}`,
              sourceGross: 100,
              sourceProcessingFee: 1,
              amountDue: 1,
              revision: 1,
              collectedAmount: 0,
              reservedAmount: 1,
              outstanding: 0,
              sign: "zero",
            });
            await ctx.db.insert("recoveryReservations", {
              operationKey: `reservation:${i}`,
              groupKey: scope.groupKey,
              amount: 1,
              limit: 1,
              allocations: [{ claimId, claimKey, amount: 1 }],
              status: "reserved",
            });
          }
          await ctx.db.patch(group._id, {
            maxDebit: 1000,
            amount: 201,
            pendingOperations: 201,
          });
          const balance = (await ctx.db.query("recoveryBalances").first())!;
          await ctx.db.patch(balance._id, {
            amountDue: 201,
            reservedAmount: 201,
          });
        },
      }),
      breakBalance: internalMutationGeneric({
        args: {},
        handler: async (ctx) => {
          const balance = await ctx.db.query("recoveryBalances").first();
          await ctx.db.patch(balance!._id, { amountDue: 1 });
        },
      }),
      repairBalance: internalMutationGeneric({
        args: {},
        handler: async (ctx) => {
          const balance = await ctx.db.query("recoveryBalances").first();
          await ctx.db.patch(balance!._id, { amountDue: 0 });
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  await t.run(async (ctx) =>
    ctx.runMutation(nested.betterStripe.costRecovery.preparation.prepare, {
      ...scope,
      sourceKind: "invoice",
      sourceId: "in_a",
      maxDebit: 100,
      maxCredit: 0,
    }),
  );
  return t;
}
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  providerGate = null;
  callbackFailures = 0;
  loseProviderJournal = false;
  result = { status: "ready", outcome: "collect" };
});
afterEach(() => vi.useRealTimers());
it("runs the real nested Workflow once and finishes recovery", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  expect(await t.mutation(anyApi.host.start, {})).toEqual(op);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.query(
    nested.betterStripe.recoveryWorkflow.queries.get,
    ref(op),
  );
  expect(saved.status).toBe("completed");
  expect(calls).toEqual(["execute"]);
});
it("sanitizes provider exceptions and reconciles without replaying execute", async () => {
  const t = await fixture();
  result = new Error("sk_test_PRIVATE provider response");
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("unknown");
  result = { status: "ready", outcome: "collect", secret: "sk_test_PRIVATE" };
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute", "reconcile"]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("unknown");
});
it("bounds automatic readiness observations and deduplicates explicit resume", async () => {
  const t = await fixture();
  result = { status: "not_ready", reason: "provider_pending" };
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute", "reconcile"]);
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  result = { status: "ready", outcome: "collect" };
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute", "reconcile", "reconcile"]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
});
it("cancels before provider dispatch without releasing the reservation", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.requestCancel,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual([]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("canceled");
  expect(
    (
      await t.query(nested.betterStripe.costRecovery.queries.group, {
        groupKey: scope.groupKey,
      })
    ).status,
  ).toBe("sealed");
});
it("restarts a failed database completion without another provider call", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  // A missing balance will be created by finish; an invalid reserved total
  // instead forces the transactional finish to fail after the provider receipt.
  await t.run(async (ctx) =>
    ctx.runMutation(nested.betterStripe.fixture.breakBalance, {}),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  await t.run(async (ctx) =>
    ctx.runMutation(nested.betterStripe.fixture.repairBalance, {}),
  );
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
});

it("collects a verified in-flight effect even after cancellation is requested", async () => {
  let release!: () => void;
  providerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.requestCancel,
    ref(op),
  );
  release();
  await drain;
  expect(
    await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)),
  ).toMatchObject({
    status: "completed",
    cancelRequested: true,
    outcome: "collect",
  });
});
it("never releases an unknown in-flight effect after cancellation", async () => {
  let release!: () => void;
  providerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  result = new Error("provider outcome lost");
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.requestCancel,
    ref(op),
  );
  release();
  await drain;
  expect(
    await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)),
  ).toMatchObject({ status: "unknown", cancelRequested: true });
  expect(
    (
      await t.query(nested.betterStripe.costRecovery.queries.group, {
        groupKey: scope.groupKey,
      })
    ).status,
  ).toBe("sealed");
});

it("restarts a failed host completion atomically while retaining the provider receipt", async () => {
  const t = await fixture();
  callbackFailures = 1;
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  expect(await t.run((ctx) => ctx.db.query("completions").collect())).toEqual(
    [],
  );
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  expect(
    await t.run((ctx) => ctx.db.query("completions").collect()),
  ).toMatchObject([{ operationId: op.operationId, outcome: "collect" }]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.run((ctx) => ctx.db.query("completions").collect()),
  ).toHaveLength(1);
});
it("continues an exhausted segment with reconciliation only and the original operation", async () => {
  const t = await fixture();
  result = new Error("provider outcome unknown");
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  for (let i = 0; i < 20; i++) {
    await t.mutation(
      nested.betterStripe.recoveryWorkflow.mutations.resume,
      ref(op),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  result = { status: "ready", outcome: "collect" };
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls.filter((p) => p === "execute")).toHaveLength(1);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
});

it("recovers an unjournaled provider success using a new reconcile-only segment", async () => {
  const t = await fixture();
  loseProviderJournal = true;
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute", "reconcile"]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
});

it("continues bounded ledger completion from the persisted receipt without another provider observation", async () => {
  const t = await fixture();
  await t.run((ctx) =>
    ctx.runMutation(nested.betterStripe.fixture.largeGroup, {}),
  );
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  expect(
    (
      await t.query(nested.betterStripe.costRecovery.queries.group, {
        groupKey: scope.groupKey,
      })
    ).pendingOperations,
  ).toBe(1);
  result = new Error("provider currently unavailable");
  await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.resume,
    ref(op),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["execute"]);
  expect(
    (await t.query(nested.betterStripe.recoveryWorkflow.queries.get, ref(op)))
      .status,
  ).toBe("completed");
  expect(
    await t.query(nested.betterStripe.costRecovery.queries.balance, {
      accountId: scope.accountId,
      scopeKey: scope.scopeKey,
      currency: scope.currency,
    }),
  ).toMatchObject({
    amountDue: 201,
    collectedAmount: 201,
    reservedAmount: 0,
    outstanding: 0,
  });
});
