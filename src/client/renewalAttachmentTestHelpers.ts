import { convexTest } from "convex-test";
import {
  actionGeneric,
  queryGeneric,
  makeFunctionReference,
  getFunctionAddress,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import { v } from "convex/values";
import { vi } from "vitest";
import { BetterStripe } from "./node.js";
import { components } from "../../example/convex/_generated/api.js";
import { modules, schema } from "../test.js";
import {
  modules as exampleModules,
  schema as exampleSchema,
} from "../../example/test.js";
import { declaredInputs } from "./billing/renewalAttach/internal/test-fixtures/attachEntries.js";
import { prepareRenewalAttachmentOperation } from "./node.js";
import type { RetainedInput } from "./billing/renewalAttach/internal/material/capture.js";
import type { AttachRenewalScheduleOptions } from "./renewalAttachmentTypes.js";

export async function attachmentFixture(
  work: (value: {
    client: BetterStripe;
    ctx: GenericActionCtx<GenericDataModel>;
    options: AttachRenewalScheduleOptions;
    record: Record<string, any>;
    calls: {
      method: string;
      path: string;
      key: string | null;
      body: unknown;
    }[];
  }) => Promise<void>,
  overrides: {
    source?: (source: RetainedInput) => void;
    key?: string;
    authorize?: boolean;
    delayResponseJournalMs?: number;
    delayBasisJournalMs?: number;
    post?: "lost" | "conflict" | "timeout";
    record?: (record: Record<string, any>) => void;
    fresh?: (subscription: Record<string, any>) => void;
  } = {},
) {
  const original = declaredInputs("PUBLIC-ATTACH");
  const source = structuredClone(original.original);
  const subscription = source.attachRequest.preparation.subscription;
  subscription.discounts = [];
  subscription.items.data[0].discounts = [];
  subscription.billing_mode = { type: "classic", flexible: null };
  source.originalBundle.wireSubscription = structuredClone(subscription);
  source.originalBundle.couponReads = [];
  source.originalBundle.derivedCouponJoins = { subscription: [], item: [] };
  overrides.source?.(source);
  const now = source.attachRequest.firstDispatchedAt * 1000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  const built = await prepareRenewalAttachmentOperation({
    preparation: source.attachRequest.preparation,
    authorization: { scope: "test-host", id: "consent", revision: 1 },
    logicalOperationId: "replacement-one",
    attachKey: source.attachRequest.attachKey,
    firstDispatchedAt: source.attachRequest.firstDispatchedAt,
  });
  const record = JSON.parse(built.createArgs.recordJSON);
  overrides.record?.(record);
  const fresh = structuredClone(source.originalBundle.wireSubscription);
  overrides.fresh?.(fresh);
  const post = structuredClone(original.post);
  const calls: {
    method: string;
    path: string;
    key: string | null;
    body: unknown;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname,
        key: headers.get("idempotency-key"),
        body: init?.body,
      });
      if (method === "POST" && overrides.post === "timeout")
        return new Promise<Response>(() => {});
      if (method === "POST" && overrides.post === "lost")
        throw new TypeError("Connection closed");
      if (method === "POST" && overrides.post === "conflict")
        return new Response(
          JSON.stringify({
            error: { type: "idempotency_error", message: "Conflict" },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      const body =
        method === "POST"
          ? post
          : url.pathname.startsWith("/v1/subscriptions/")
            ? fresh
            : url.pathname.startsWith("/v1/prices/")
              ? source.originalBundle.wireTargetPrice
              : source.originalBundle.wireBillingCustomer;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const client = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: overrides.key ?? "sk_test_public_attachment",
  });
  const authorizationQuery = makeFunctionReference<"query", any, boolean>(
    "attachmentHost:authorize",
  );
  const host = {
    authorize: queryGeneric({
      args: {
        capability: v.string(),
        operationId: v.string(),
        authorizationScope: v.string(),
        authorizationId: v.string(),
        authorizationRevision: v.number(),
        logicalOperationId: v.string(),
        requestBinding: v.string(),
        expected: v.any(),
      },
      returns: v.boolean(),
      handler: () => overrides.authorize !== false,
    }),
    run: actionGeneric({
      args: {},
      returns: v.null(),
      handler: async (ctx) => {
        if (overrides.delayResponseJournalMs || overrides.delayBasisJournalMs) {
          const runMutation = ctx.runMutation;
          ctx.runMutation = async (ref, ...args) => {
            const result = await runMutation(ref, ...args);
            if (
              overrides.delayBasisJournalMs &&
              getFunctionAddress(ref).reference?.endsWith("/bindInitialBasis")
            )
              await new Promise((resolve) =>
                setTimeout(resolve, overrides.delayBasisJournalMs),
              );
            const event = (
              args[0] as { event?: { sequence?: number } } | undefined
            )?.event;
            if (event?.sequence === 2)
              await new Promise((resolve) =>
                setTimeout(resolve, overrides.delayResponseJournalMs),
              );
            return result;
          };
        }
        const created = await ctx.runMutation(
          components.betterStripe.renewalOperations.mutations
            .createAuthorizedOperation,
          {
            authorizationScope: record.authorization.scope,
            authorizationRevision: record.authorization.revision,
            logicalOperationId: record.logicalOperationId,
            recordJSON: JSON.stringify(record),
          },
        );
        if (created.status !== "created")
          throw Error("fixture operation not created");
        await work({
          client,
          ctx,
          record,
          calls,
          options: {
            operationId: created.operationId,
            requestBinding: record.requestBinding,
            authorizationQuery,
          },
        });
        return null;
      },
    }),
  };
  const t = convexTest(exampleSchema, {
    ...exampleModules,
    "./convex/attachmentHost.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, modules);
  await t.action(
    makeFunctionReference<"action", {}, null>("attachmentHost:run"),
    {},
  );
}
