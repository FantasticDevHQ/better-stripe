// @vitest-environment edge-runtime
import workflowTest from "@convex-dev/workflow/test";
import type { WorkflowId } from "@convex-dev/workflow";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { convexTest } from "convex-test";
import {
  anyApi,
  componentsGeneric,
  defineSchema,
  internalActionGeneric,
  internalQueryGeneric,
  internalMutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";
import { afterEach, beforeEach, vi } from "vitest";
import { BetterStripe } from "../../client/index.js";
import { getStripeClient, type Component } from "../../client/helpers.js";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION as version } from "../../client/apiVersion.js";
import { internal } from "../_generated/api.js";
import { workflowRefFields } from "./workflowValidators.js";
import { provisioningReceipt } from "./workflowSchema.js";
import { schema, modules } from "../../test.js";

export const nested = componentsGeneric();
export const scope = { accountId: "acct_owner", scopeKey: "opaque-scope" };
export const stripeSubscriptionId = "sub_original";
export const original = {
  customerAccount: scope.accountId,
  stripeSubscriptionId,
  previousPaymentMethodId: "pm_card",
  previousPaymentMethodTypes: ["card"],
};
const phaseArgs = {
  ...{
    accountId: v.string(),
    scopeKey: v.string(),
    operationId: v.string(),
    version: v.number(),
  },
  stripeSubscriptionId: v.string(),
  providerApiVersion: v.string(),
  definitionVersion: v.string(),
  phase: v.union(v.literal("create"), v.literal("attach"), v.literal("apply")),
  providerKey: v.string(),
};
let requests: {
  method: string;
  path: string;
  version: string | null;
  key: string | null;
}[];
let methodOwner: string | null;
let unknownPhase: "create" | "attach" | null;
let extraFields: boolean;
let enabled: boolean;
let lostApply: boolean;
let checkpointFault: boolean;
let cancelPhase: "create" | "attach" | "apply" | null;
function client() {
  const sdk = new BetterStripe(nested.betterStripe as unknown as Component, {
    stripeApiVersion: version,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  });
  return sdk.balanceFundingWorkflow;
}

const host = {
  prepare: internalActionGeneric({
    args: { requestKey: v.string() },
    returns: v.any(),
    handler: async (ctx, { requestKey }) =>
      client().prepare(ctx, {
        ...scope,
        stripeSubscriptionId,
        requestKey,
        consent: true,
        consentAt: 100,
        consentReference: "original-consent",
        providerAction: anyApi.host.provider,
      }),
  }),
  provider: internalActionGeneric({
    args: phaseArgs,
    returns: v.any(),
    handler: async (ctx, args) => {
      const result = await client().executeProviderPhase(ctx, args);
      if (cancelPhase === args.phase) {
        cancelPhase = null;
        await client().cancel(ctx, {
          accountId: args.accountId,
          scopeKey: args.scopeKey,
          stripeSubscriptionId: args.stripeSubscriptionId,
          operationId: args.operationId,
          version: args.version,
        });
      }
      if (!extraFields) return result;
      const response = result as { status: string; value?: object };
      return {
        ...response,
        value: {
          ...response.value,
          rawProviderObject: "raw_provider_private_field",
        },
      };
    },
  }),
  apply: internalActionGeneric({
    args: {
      preparationId: v.string(),
      enabled: v.boolean(),
      requestKey: v.string(),
    },
    returns: v.any(),
    handler: (ctx, args) =>
      new BetterStripe(nested.betterStripe as unknown as Component, {
        stripeApiVersion: version,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      }).balanceFundingWorkflow.apply(ctx, {
        ...args,
        ...scope,
        stripeSubscriptionId,
        consent: true,
        providerAction: anyApi.host.provider,
      }),
  }),
  resume: internalActionGeneric({
    args: { operationId: v.string(), version: v.number() },
    returns: v.any(),
    handler: async (ctx, args) =>
      client().resume(ctx, { ...args, ...scope, stripeSubscriptionId }),
  }),
  inspect: internalActionGeneric({
    args: { operationId: v.string(), version: v.number() },
    returns: v.any(),
    handler: (ctx, args) =>
      client().inspect(ctx, { ...args, ...scope, stripeSubscriptionId }),
  }),
  cancel: internalActionGeneric({
    args: { operationId: v.string(), version: v.number() },
    returns: v.any(),
    handler: async (ctx, args) =>
      client().cancel(ctx, { ...args, ...scope, stripeSubscriptionId }),
  }),
};
export function setup(
  failFinish = false,
  failReceipt = false,
  stopBeforeApplyRecord = false,
) {
  let attempts = 0;
  let receiptAttempts = 0;
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./host.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    ...(stopBeforeApplyRecord
      ? {
          "./component/balanceFunding/internal/workflow.ts": async () => {
            const modulePath = "./internal/workflow.ts";
            const actual = await import(/* @vite-ignore */ modulePath);
            if (!checkpointFault) return actual;
            return {
              ...actual,
              run: executionWorkflow.define({
                args: workflowRefFields,
                returns: v.null(),
                handler: async (step, args): Promise<null> => {
                  const plan = await step.runQuery(
                    internal.balanceFunding.internal.queries.plan,
                    args,
                    { name: "plan-v1" },
                  );
                  await step.runAction(
                    internal.balanceFunding.internal.actions.bridge,
                    { ...args, phase: "apply", providerKey: plan.applyKey },
                    { name: "apply-provider-v1", retry: false },
                  );
                  throw new Error(
                    "controlled stop at durable provider checkpoint",
                  );
                },
              }),
            };
          },
        }
      : {}),
    ...(failFinish || failReceipt
      ? {
          "./component/balanceFunding/internal/mutations.ts": async () => {
            const modulePath = "./internal/mutations.ts";
            const statePath = "./workflowState.ts";
            const actual = await import(/* @vite-ignore */ modulePath);
            const state = await import(/* @vite-ignore */ statePath);
            return {
              ...actual,
              recordProviderReceipt: internalMutationGeneric({
                args: { ...phaseArgs, receipt: provisioningReceipt },
                returns: v.null(),
                handler: async (ctx, args) => {
                  if (
                    failReceipt &&
                    args.phase ===
                      (stopBeforeApplyRecord ? "apply" : "attach") &&
                    receiptAttempts++ < 2
                  )
                    throw new Error("controlled receipt-store outage");
                  return state.recordProviderReceiptHandler(ctx, args);
                },
              }),
              finishFromReceipts: internalMutationGeneric({
                args: {
                  accountId: v.string(),
                  scopeKey: v.string(),
                  operationId: v.string(),
                  version: v.number(),
                  stripeSubscriptionId: v.string(),
                  providerApiVersion: v.string(),
                  definitionVersion: v.string(),
                },
                returns: v.null(),
                handler: async (ctx, args) => {
                  if (failFinish && ++attempts === 1)
                    throw new Error("controlled receipt-finish outage");
                  return state.finishFromReceiptsHandler(ctx, args);
                },
              }),
            };
          },
        }
      : {}),
    "./component/fundingWorkflowFixture.ts": async () => ({
      status: internalQueryGeneric({
        args: { id: v.string() },
        returns: v.any(),
        handler: (ctx, { id }) =>
          executionWorkflow.status(ctx, id as WorkflowId),
      }),
      cleanup: internalMutationGeneric({
        args: { id: v.string() },
        returns: v.any(),
        handler: (ctx, args) =>
          executionWorkflow.cleanup(ctx, args.id as WorkflowId),
      }),
      history: internalQueryGeneric({
        args: { id: v.string() },
        returns: v.any(),
        handler: (ctx, { id }) =>
          executionWorkflow.listSteps(ctx, id as WorkflowId, {
            paginationOpts: { cursor: null, numItems: 30 },
          }),
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  return t;
}
beforeEach(() => {
  vi.useFakeTimers();
  const secret = "sk_test_funding_" + crypto.randomUUID();
  vi.stubEnv("STRIPE_SECRET_KEY", secret);
  requests = [];
  methodOwner = null;
  unknownPhase = null;
  extraFields = false;
  enabled = false;
  lostApply = false;
  checkpointFault = false;
  cancelPhase = null;
  const stripe = getStripeClient(secret, version);
  (
    stripe as unknown as {
      _setApiField: (name: string, value: unknown) => void;
    }
  )._setApiField(
    "httpClient",
    Stripe.createFetchHttpClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({
        method,
        path,
        version: headers.get("Stripe-Version"),
        key: headers.get("Idempotency-Key"),
      });
      if (path.includes("subscriptions") && method === "POST") {
        const body = new URLSearchParams(String(init?.body));
        enabled = body.get("default_payment_method") === "pm_balance";
        if (lostApply) {
          lostApply = false;
          throw new TypeError("private apply response");
        }
      }
      if (path.endsWith("/attach") && method === "POST")
        methodOwner = scope.accountId;
      if (
        (unknownPhase === "create" &&
          path === "/v1/payment_methods" &&
          method === "POST") ||
        (unknownPhase === "attach" &&
          path.endsWith("/attach") &&
          method === "POST")
      ) {
        unknownPhase = null;
        throw new TypeError("raw_provider_private_failure");
      }
      const body = path.includes("subscriptions")
        ? {
            id: stripeSubscriptionId,
            object: "subscription",
            customer_account: scope.accountId,
            status: "active",
            default_payment_method: enabled ? "pm_balance" : "pm_card",
            payment_settings: {
              payment_method_types: [enabled ? "stripe_balance" : "card"],
            },
          }
        : path.endsWith("/pm_card")
          ? {
              id: "pm_card",
              object: "payment_method",
              type: "card",
              customer_account: scope.accountId,
            }
          : {
              id: "pm_balance",
              object: "payment_method",
              type: "stripe_balance",
              customer_account: methodOwner,
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

export const fixture = {
  set checkpointFault(value: boolean) {
    checkpointFault = value;
  },
  set cancelPhase(value: "create" | "attach" | "apply" | null) {
    cancelPhase = value;
  },
  get requests() {
    return requests;
  },
  set unknownPhase(value: "create" | "attach" | null) {
    unknownPhase = value;
  },
  set extraFields(value: boolean) {
    extraFields = value;
  },
  set lostApply(value: boolean) {
    lostApply = value;
  },
  get enabled() {
    return enabled;
  },
};
