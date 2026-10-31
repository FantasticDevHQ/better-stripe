import assert from "node:assert/strict";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  queryGeneric,
  defineSchema,
  makeFunctionReference,
  getFunctionAddress,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { modules, schema } from "../../../../../test.js";
import {
  canonical,
  codecFixture,
} from "../../../../../component/renewalOperations/timingPolicy.fixtures.js";
import { createClassActionOperationJournal } from "../operationJournal.js";
import type { RetainedInput } from "../material/capture.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";

type Journal = Awaited<ReturnType<typeof createClassActionOperationJournal>>;
type Fresh = Awaited<ReturnType<Journal["reserveFreshAttempt"]>>;
export async function initialOperations(
  work: (input: {
    journal: Journal;
    fresh: Fresh;
    sdk: BetterStripe;
    index: number;
    ctx: GenericActionCtx<GenericDataModel>;
    inAnotherAction(
      work: (ctx: GenericActionCtx<GenericDataModel>) => Promise<void>,
    ): Promise<void>;
  }) => Promise<void>,
  count = 1,
  options: {
    identity?: { subject: string; issuer: string; tokenIdentifier: string };
    hostQuery?: ReturnType<typeof queryGeneric>;
    hostInvoiceQuery?: ReturnType<typeof queryGeneric>;
    epochMs?: number;
    workEndWallMs?: number;
    endWallMs?: number;
    afterBind?: (reply: unknown) => Promise<void>;
    afterQuery?: (
      reply: unknown,
      reference: string,
      args: unknown,
    ) => Promise<void>;
    afterAppend?: () => Promise<void>;
    beforeAppend?: () => Promise<void>;
    afterRetain?: () => Promise<void>;
    source?: RetainedInput;
    sources?: readonly RetainedInput[];
    keys?: readonly string[];
  } = {},
) {
  const h = await codecFixture();
  if (options.epochMs !== undefined) {
    const seconds = Math.floor(options.epochMs / 1000);
    const source = h.record.attachRequest;
    source.preparation.expected.periodStart = seconds - 1;
    source.preparation.expected.periodEnd = seconds + 2592000;
    const item = source.preparation.subscription.items.data[0];
    item.current_period_start = seconds - 1;
    item.current_period_end = seconds + 2592000;
    source.firstDispatchedAt = seconds;
    const prepared = await prepareRenewalPriceReplacementV2(source.preparation);
    const request = await prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: source.apiVersion,
      attachKey: source.attachKey,
      firstDispatchedAt: seconds,
    });
    h.record.requestBinding = request.requestIdentity.binding;
    h.record.dispatch = {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: seconds,
    };
    Object.assign(h.record.timingPolicy, {
      firstDispatchedAt: seconds,
      periodStart: seconds - 1,
      periodEnd: seconds + 2592000,
      workEndWallMs: options.epochMs + 10000,
      endWallMs: options.epochMs + 11000,
    });
  }
  if (options.workEndWallMs !== undefined)
    h.record.timingPolicy.workEndWallMs = options.workEndWallMs;
  if (options.endWallMs !== undefined)
    h.record.timingPolicy.endWallMs = options.endWallMs;
  const source = options.source?.attachRequest ?? h.record.attachRequest;
  const prepared = await prepareRenewalPriceReplacementV2(source.preparation);
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: source.apiVersion,
    attachKey: source.attachKey,
    firstDispatchedAt: source.firstDispatchedAt,
  });
  const record = {
    ...h.record,
    attachRequest: source,
    originalBundle: options.source?.originalBundle ?? h.record.originalBundle,
    requestBinding: request.requestIdentity.binding,
    dispatch: {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    },
    timingPolicy: {
      ...h.record.timingPolicy,
      firstDispatchedAt: source.firstDispatchedAt,
      periodStart: prepared.expected.periodStart,
      periodEnd: prepared.expected.periodEnd,
    },
  };
  assert(!options.sources || options.sources.length === count);
  assert(!options.keys || options.keys.length === count);
  const records = options.sources
    ? await Promise.all(
        options.sources.map(async (original) => {
          const raw = original.attachRequest;
          const prepared = await prepareRenewalPriceReplacementV2(
            raw.preparation,
          );
          const request = await prepareRenewalScheduleAttachmentV2({
            prepared,
            apiVersion: raw.apiVersion,
            attachKey: raw.attachKey,
            firstDispatchedAt: raw.firstDispatchedAt,
          });
          return {
            ...record,
            attachRequest: raw,
            originalBundle: original.originalBundle,
            requestBinding: request.requestIdentity.binding,
            dispatch: {
              scope: request.scope,
              apiVersion: request.apiVersion,
              method: request.method,
              path: request.path,
              payload: request.payload,
              key: request.key,
              firstDispatchedAt: request.firstDispatchedAt,
            },
            timingPolicy: {
              ...record.timingPolicy,
              firstDispatchedAt: raw.firstDispatchedAt,
              periodStart: prepared.expected.periodStart,
              periodEnd: prepared.expected.periodEnd,
            },
          };
        }),
      )
    : null;
  const sdk = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_invalid_owner_core",
  });
  const sdks = options.keys?.map(
    (key) =>
      new BetterStripe(components.betterStripe, { STRIPE_SECRET_KEY: key }),
  );
  const refs = components.betterStripe.renewalOperations;
  const secondaryWork = new Map<
    string,
    (ctx: GenericActionCtx<GenericDataModel>) => Promise<void>
  >();
  let secondaryId = 0;
  const host = {
    ...(options.hostQuery ? { authorize: options.hostQuery } : {}),
    ...(options.hostInvoiceQuery
      ? { authorizeInvoices: options.hostInvoiceQuery }
      : {}),
    secondary: actionGeneric({
      args: { id: v.string() },
      handler: async (ctx, args): Promise<null> => {
        const work = secondaryWork.get(args.id);
        assert(work);
        secondaryWork.delete(args.id);
        await work(ctx);
        return null;
      },
    }),
    run: actionGeneric({
      args: {},
      handler: async (ctx): Promise<null> => {
        const runMutation = ctx.runMutation;
        const runQuery = ctx.runQuery;
        if (options.afterQuery)
          ctx.runQuery = async (ref, ...args) => {
            const reply = await runQuery(ref, ...args);
            await options.afterQuery?.(
              reply,
              getFunctionAddress(ref).reference ?? "",
              args[0],
            );
            return reply;
          };
        if (
          options.afterBind ||
          options.afterAppend ||
          options.afterRetain ||
          options.beforeAppend
        )
          ctx.runMutation = async (ref, ...args) => {
            if (
              getFunctionAddress(ref).reference?.endsWith(
                "/appendStageEvent",
              ) &&
              options.beforeAppend
            )
              await options.beforeAppend();
            const result = await runMutation(ref, ...args);
            if (
              getFunctionAddress(ref).reference?.endsWith(
                "/bindInitialBasis",
              ) &&
              options.afterBind
            )
              await options.afterBind(result);
            if (
              getFunctionAddress(ref).reference?.endsWith(
                "/appendStageEvent",
              ) &&
              options.afterAppend
            )
              await options.afterAppend();
            if (
              getFunctionAddress(ref).reference?.endsWith(
                "/retainProviderAcknowledgement",
              ) &&
              options.afterRetain
            )
              await options.afterRetain();
            return result;
          };
        await Promise.all(
          Array.from({ length: count }, async (_, index) => {
            const current = records?.[index] ?? record;
            const selectedSDK = sdks?.[index] ?? sdk;
            const logicalOperationId =
              current.logicalOperationId + "-owner-" + index;
            const recordJSON = canonical({ ...current, logicalOperationId });
            const created = await ctx.runMutation(
              refs.mutations.createAuthorizedOperation,
              {
                authorizationScope: current.authorization.scope,
                authorizationRevision: current.authorization.revision,
                logicalOperationId,
                recordJSON,
              },
            );
            assert(created.status === "created");
            const journal = await createClassActionOperationJournal(
              selectedSDK,
              {
                actualActionCtx: ctx,
                operationId: created.operationId,
              },
            );
            const fresh = await journal.reserveFreshAttempt({
              expectedRevision: 0,
              stage: "attach",
              expectedRequestBinding: current.requestBinding,
              recordJSON,
            });
            assert(fresh.result.disposition === "acquired" && fresh.call);
            await work({
              journal,
              fresh,
              sdk: selectedSDK,
              index,
              ctx,
              async inAnotherAction(work) {
                const id = String(++secondaryId);
                secondaryWork.set(id, work);
                try {
                  await ctx.runAction(
                    makeFunctionReference<"action", { id: string }, null>(
                      "initialOwner:secondary",
                    ),
                    { id },
                  );
                } finally {
                  secondaryWork.delete(id);
                }
              },
            });
          }),
        );
        return null;
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./initialOwner.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, modules);
  await (options.identity ? t.withIdentity(options.identity) : t).action(
    makeFunctionReference<"action", {}, null>("initialOwner:run"),
    {},
  );
  assert(h.fetchCalls() === 0);
}
