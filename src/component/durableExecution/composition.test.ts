import {
  type WorkflowId,
  vResultValidator,
  vWorkflowId,
} from "@convex-dev/workflow";
import {
  Workpool,
  type WorkId,
  type WorkpoolComponent,
} from "@convex-dev/workpool";
import workpoolTest from "@convex-dev/workpool/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import {
  anyApi,
  componentsGeneric,
  createFunctionHandle,
  defineSchema,
  defineTable,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type FunctionHandle,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";
import { executionWorkflow } from "./runtime.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const nested = componentsGeneric();
const manager = executionWorkflow;
const independent = new Workpool(
  nested.independent as unknown as WorkpoolComponent,
  {
    maxParallelism: 1,
    retryActionsByDefault: false,
  },
);
const request = {
  operationKey: v.string(),
  stripeAccountId: v.string(),
  apiVersion: v.string(),
};
const receipt = v.object({ stripeId: v.string(), apiVersion: v.string() });
type Request = {
  operationKey: string;
  stripeAccountId: string;
  apiVersion: string;
};
type Receipt = { stripeId: string; apiVersion: string };
const workflowRef = anyApi.fixture.workflow as FunctionReference<
  "mutation",
  "internal"
>;
let calls: Request[];
let failUntil: number;
let providerUnknown: boolean;
let definitionChanged: boolean;
let active: number;
let peak: number;
let commitFailures: number;
let commitCalls: number;
let providerDelay: number;
let providerGate: Promise<void> | null;
let transport: {
  authenticated: boolean;
  version: string | null;
  account: string | null;
}[];
const testSecret = "sk_test_runtime_composition_fixture";
const host = {
  enqueue: internalMutationGeneric({
    args: request,
    returns: v.string(),
    handler: async (ctx, args): Promise<string> =>
      ctx.runMutation(nested.betterStripe.fixture.enqueue, {
        ...args,
        provider: await createFunctionHandle(anyApi.host.provider),
      }),
  }),
  provider: internalActionGeneric({
    args: request,
    returns: receipt,
    handler: async (_ctx, args): Promise<Receipt> => {
      calls.push(args);
      active++;
      peak = Math.max(peak, active);
      try {
        if (providerGate) await providerGate;
        if (providerDelay)
          await new Promise((resolve) => setTimeout(resolve, providerDelay));
        if (calls.length <= failUntil)
          throw new Error("transient transport unavailable");
        // Only Stripe transport is replaced. The SDK reads credentials at action
        // execution and uses the selected preview version/account header.
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: args.apiVersion as Stripe.LatestApiVersion,
          maxNetworkRetries: 0,
          httpClient: Stripe.createFetchHttpClient(async (_url, init) => {
            const headers = new Headers(init?.headers);
            transport.push({
              authenticated:
                headers.get("Authorization") === `Bearer ${testSecret}`,
              version: headers.get("Stripe-Version"),
              account: headers.get("Stripe-Account"),
            });
            if (providerUnknown)
              throw new TypeError(
                "provider response lost after possible effect",
              );
            return new Response(
              JSON.stringify({ id: "cus_fixture", object: "customer" }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }),
        });
        const customer = await stripe.customers.retrieve(
          "cus_fixture",
          {},
          {
            stripeAccount: args.stripeAccountId,
          },
        );
        return { stripeId: customer.id, apiVersion: args.apiVersion };
      } finally {
        active--;
      }
    },
  }),
  start: internalMutationGeneric({
    args: { ...request, retry: v.boolean(), wait: v.boolean() },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
      const provider = await createFunctionHandle(anyApi.host.provider);
      return ctx.runMutation(nested.betterStripe.fixture.start, {
        ...args,
        provider,
      });
    },
  }),
};
const fixture = {
  enqueue: internalMutationGeneric({
    args: { ...request, provider: v.string() },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> =>
      independent.enqueueAction(
        ctx,
        args.provider as FunctionHandle<"action", Request, Receipt>,
        {
          operationKey: args.operationKey,
          stripeAccountId: args.stripeAccountId,
          apiVersion: args.apiVersion,
        },
        {
          retry: false,
          onComplete: anyApi.fixture.queueComplete,
          context: { operationKey: args.operationKey },
        },
      ),
  }),
  queueComplete: internalMutationGeneric({
    args: {
      workId: v.string(),
      result: vResultValidator,
      context: v.object({ operationKey: v.string() }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      await ctx.db.insert("completions", {
        operationKey: args.context.operationKey,
        kind: args.result.kind,
      });
      return null;
    },
  }),
  queueStatus: internalQueryGeneric({
    args: { id: v.string() },
    returns: v.any(),
    handler: async (ctx, { id }) => independent.status(ctx, id as WorkId),
  }),
  ledger: internalQueryGeneric({
    args: {},
    returns: v.any(),
    handler: async (ctx) => ({
      receipts: await ctx.db.query("receipts").take(10),
      completions: await ctx.db.query("completions").take(10),
    }),
  }),
  commit: internalMutationGeneric({
    args: { operationKey: v.string(), receipt },
    returns: v.null(),
    handler: async (ctx, args) => {
      commitCalls++;
      if (commitCalls <= commitFailures)
        throw new Error("receipt persistence unavailable");
      await ctx.db.insert("receipts", { operationKey: args.operationKey });
      return null;
    },
  }),
  complete: internalMutationGeneric({
    args: {
      workflowId: vWorkflowId,
      result: vResultValidator,
      context: v.object({ operationKey: v.string() }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      await ctx.db.insert("completions", {
        operationKey: args.context.operationKey,
        kind: args.result.kind,
      });
      return null;
    },
  }),
  control: internalMutationGeneric({
    args: {
      id: v.string(),
      command: v.union(
        v.literal("cancel"),
        v.literal("restart"),
        v.literal("cleanup"),
        v.literal("signal"),
      ),
    },
    returns: v.any(),
    handler: async (ctx, { id, command }) => {
      if (command === "cancel") {
        await manager.cancel(ctx, id as WorkflowId);
        return null;
      }
      if (command === "restart") {
        await manager.restart(ctx, id as WorkflowId, {
          from: anyApi.fixture.commit,
        });
        return null;
      }
      if (command === "signal") {
        await manager.sendEvent(ctx, {
          workflowId: id as WorkflowId,
          name: "reconcile",
          value: null,
        });
        return null;
      }
      return manager.cleanup(ctx, id as WorkflowId);
    },
  }),
  history: internalQueryGeneric({
    args: { id: v.string() },
    returns: v.any(),
    handler: async (ctx, { id }) => ({
      workflows: await manager.list(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
      steps: await manager.listSteps(ctx, id as WorkflowId, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
      receipts: await ctx.db.query("receipts").take(10),
      completions: await ctx.db.query("completions").take(10),
    }),
  }),
  status: internalQueryGeneric({
    args: { id: v.string() },
    returns: v.any(),
    handler: async (ctx, { id }) => manager.status(ctx, id as WorkflowId),
  }),
  workflow: manager
    .define({
      args: {
        ...request,
        provider: v.string(),
        retry: v.boolean(),
        wait: v.boolean(),
      },
      returns: receipt,
    })
    .handler(async (step, args): Promise<Receipt> => {
      const result = await step.runAction(
        args.provider as FunctionHandle<"action", Request, Receipt>,
        {
          operationKey: args.operationKey,
          stripeAccountId: args.stripeAccountId,
          apiVersion: definitionChanged
            ? "changed-definition-version"
            : args.apiVersion,
        },
        {
          name: "provider-v1",
          retry: args.retry
            ? { maxAttempts: 2, initialBackoffMs: 1, base: 2 }
            : false,
        },
      );
      if (args.wait) await step.awaitEvent({ name: "reconcile" });
      await step.runMutation(anyApi.fixture.commit, {
        operationKey: args.operationKey,
        receipt: result,
      });
      return result;
    }),
  start: internalMutationGeneric({
    args: {
      ...request,
      provider: v.string(),
      retry: v.boolean(),
      wait: v.boolean(),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> =>
      manager.start(ctx, workflowRef, args, {
        onComplete: anyApi.fixture.complete,
        context: { operationKey: args.operationKey },
      }),
  }),
};
function setup() {
  const app = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./host.ts": async () => host,
  });
  app.registerComponent(
    "betterStripe",
    defineSchema({
      receipts: defineTable({ operationKey: v.string() }),
      completions: defineTable({ operationKey: v.string(), kind: v.string() }),
    }),
    {
      "./_generated/api.ts": async () => ({}),
      "./fixture.ts": async () => fixture,
    },
  );
  const child = workflowTest.register(app, "betterStripe/workflow");
  workpoolTest.register(app, "betterStripe/independent");
  return { t: app, child };
}
const args = {
  operationKey: "operation:1:apply:v1",
  stripeAccountId: "acct_scope",
  apiVersion: "2026-02-25.preview",
  retry: false,
  wait: false,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("STRIPE_SECRET_KEY", testSecret);
  calls = [];
  failUntil = 0;
  providerUnknown = false;
  definitionChanged = false;
  active = 0;
  peak = 0;
  transport = [];
  commitFailures = 0;
  commitCalls = 0;
  providerDelay = 0;
  providerGate = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("executes a host credential action through nested Workflow/Workpool with version and scope", async () => {
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const status = await t.query(nested.betterStripe.fixture.status, { id });
  expect(status).toEqual({
    type: "completed",
    result: { stripeId: "cus_fixture", apiVersion: args.apiVersion },
  });
  expect(transport).toEqual([
    {
      authenticated: true,
      version: args.apiVersion,
      account: args.stripeAccountId,
    },
  ]);
  expect(calls).toEqual([
    {
      operationKey: args.operationKey,
      stripeAccountId: args.stripeAccountId,
      apiVersion: args.apiVersion,
    },
  ]);
  expect(JSON.stringify(status)).not.toContain(testSecret);
});

it("replays the saved provider receipt after a later persistence failure", async () => {
  commitFailures = 1;
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "failed" });
  await t.mutation(nested.betterStripe.fixture.control, {
    id,
    command: "restart",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "completed" });
  expect(calls).toHaveLength(1);
  expect(commitCalls).toBe(2);
  const history = await t.query(nested.betterStripe.fixture.history, { id });
  expect(history.receipts).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain(testSecret);
  expect(JSON.stringify(history)).toContain(args.operationKey);
  expect(
    await t.mutation(nested.betterStripe.fixture.control, {
      id,
      command: "cleanup",
    }),
  ).toBe(true);
  const retained = await t.query(nested.betterStripe.fixture.ledger, {});
  // Cleanup removes execution history only. The separate receipt remains.
  expect(retained.receipts).toHaveLength(1);
  await expect(
    t.mutation(nested.betterStripe.fixture.control, { id, command: "restart" }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  expect(
    retained.completions.map((entry: { kind: string }) => entry.kind),
  ).toEqual(["failed", "success"]);
});

it("retries only when explicitly opted in and honors the configured attempt cap", async () => {
  failUntil = 10;
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, { ...args, retry: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toHaveLength(2);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "failed" });
});

it("does not automatically repeat an unknown provider effect", async () => {
  providerUnknown = true;
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toHaveLength(1);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({
    type: "failed",
    error: expect.stringContaining("connection to Stripe"),
  });
  // A failed execution is not a rejected/canceled financial outcome. The
  // operation owner must reconcile the same phase key before any restart.
  expect(commitCalls).toBe(0);
  expect(transport).toHaveLength(1);
});

it("caps provider action concurrency across parallel workflows", async () => {
  providerDelay = 10;
  const { t } = setup();
  const ids = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      t.mutation(anyApi.host.start, {
        ...args,
        operationKey: `operation:${n}:apply:v1`,
      }),
    ),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(peak).toBe(2);
  expect(calls).toHaveLength(4);
  for (const id of ids)
    expect(
      await t.query(nested.betterStripe.fixture.status, { id }),
    ).toMatchObject({ type: "completed" });
});

it("cancellation cannot undo a provider step already in flight", async () => {
  let release!: () => void;
  providerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, args);
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await t.mutation(nested.betterStripe.fixture.control, {
    id,
    command: "cancel",
  });
  release();
  await drain;
  expect(transport).toHaveLength(1);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "canceled" });
  expect(commitCalls).toBe(0);
});

it("runs an independent queued provider job without creating a workflow", async () => {
  const { t } = setup();
  const id = await t.mutation(anyApi.host.enqueue, {
    operationKey: args.operationKey,
    stripeAccountId: args.stripeAccountId,
    apiVersion: args.apiVersion,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.queueStatus, { id }),
  ).toMatchObject({ state: "finished" });
  expect(calls).toHaveLength(1);
  expect(await t.query(nested.betterStripe.fixture.ledger, {})).toMatchObject({
    completions: [{ operationKey: args.operationKey, kind: "success" }],
  });
});

it("retains a waiting workflow until reconciliation and exposes reactive status", async () => {
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, { ...args, wait: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "inProgress" });
  expect(
    await t.mutation(nested.betterStripe.fixture.control, {
      id,
      command: "cleanup",
    }),
  ).toBe(false);
  expect(commitCalls).toBe(0);
  await t.mutation(nested.betterStripe.fixture.control, {
    id,
    command: "signal",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "completed" });
  expect(calls).toHaveLength(1);
  expect(await t.query(nested.betterStripe.fixture.ledger, {})).toMatchObject({
    completions: [{ kind: "success" }],
  });
});

it("refuses changed-definition provider arguments during saved-history replay", async () => {
  const { t } = setup();
  const id = await t.mutation(anyApi.host.start, { ...args, wait: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  definitionChanged = true;
  await t.mutation(nested.betterStripe.fixture.control, {
    id,
    command: "signal",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fixture.status, { id }),
  ).toMatchObject({ type: "failed" });
  expect(calls).toHaveLength(1);
  expect(calls[0].apiVersion).toBe(args.apiVersion);
  expect(commitCalls).toBe(0);
  const history = await t.query(nested.betterStripe.fixture.history, { id });
  expect(JSON.stringify(history.steps)).toContain(args.apiVersion);
});
