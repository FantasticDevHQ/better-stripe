import { vi } from "vitest";
import { makeFunctionReference, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { prepareFreshObservation } from "./freshObservation.js";
import {
  prepareInvoiceObservation,
  authorizeInvoices,
} from "./invoiceObservation.js";
import { observerIdentity } from "./observationReader.js";
import type { WitnessScope } from "../operations/witnessProfiles.js";
import {
  captureFreshWitnessRenewalObservation,
  captureHistoricalWitnessRenewalObservation,
} from "../observation/freshActor.js";

const witnessControls = vi.hoisted(() => ({
  captures: [] as unknown[],
  readers: [] as unknown[],
  scope: null as WitnessScope | null,
  retainQueries: 0,
  readQueries: 0,
  denyRetain: false,
  denyRead: false,
  expiresAtMs: 0,
  allowedReaders: [] as string[],
  onRetainGrant: null as
    null | ((grant: Record<string, unknown>, count: number) => void),
  onReadGrant: null as
    null | ((grant: Record<string, unknown>, count: number) => void),
}));
export { witnessControls };
vi.mock("../operations/witnessProfiles.js", () => ({
  COMPILED_WITNESS_CAPTURE_ENTRIES: witnessControls.captures,
  COMPILED_WITNESS_READ_ENTRIES: witnessControls.readers,
}));

const identity = v.object({
  componentScope: v.string(),
  witnessId: v.string(),
  parentOperationId: v.string(),
  operationId: v.string(),
});
const scope = v.object({
  identity,
  providerScope: v.object({
    mode: v.literal("platform"),
    stripeAccount: v.null(),
    livemode: v.boolean(),
    customerAccountId: v.string(),
    customerId: v.string(),
    subscriptionId: v.string(),
    scheduleId: v.string(),
  }),
  configureRequestBinding: v.string(),
  observedItemId: v.string(),
  nativePeriod: v.object({ start: v.number(), end: v.number() }),
});
const grantFields = {
  scope,
  tokenIdentifier: v.string(),
  authorizationId: v.string(),
  authorizationRevision: v.number(),
  expiresAtMs: v.number(),
};
export const authorizeWitnessObservation = queryGeneric({
  args: {
    componentScope: v.string(),
    parentOperationId: v.string(),
    operationId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      componentScope: v.string(),
      parentOperationId: v.string(),
      operationId: v.string(),
      tokenIdentifier: v.string(),
      authorizationId: v.string(),
      authorizationRevision: v.number(),
      expiresAtMs: v.number(),
      providerScope: v.object({
        mode: v.literal("platform"),
        stripeAccount: v.null(),
        livemode: v.boolean(),
        customerAccountId: v.string(),
        subscriptionId: v.string(),
        scheduleId: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const who = await ctx.auth.getUserIdentity(),
      expected = witnessControls.scope;
    if (
      !who ||
      !witnessControls.allowedReaders.includes(who.tokenIdentifier) ||
      !expected ||
      args.componentScope !== expected.identity.componentScope ||
      args.parentOperationId !== expected.identity.parentOperationId ||
      args.operationId !== expected.identity.operationId
    )
      return null;
    const p = expected.providerScope;
    return {
      ...args,
      tokenIdentifier: who.tokenIdentifier,
      authorizationId: "test-witness-base",
      authorizationRevision: 1,
      expiresAtMs: witnessControls.expiresAtMs,
      providerScope: {
        mode: p.mode,
        stripeAccount: p.stripeAccount,
        livemode: p.livemode,
        customerAccountId: p.customerAccountId,
        subscriptionId: p.subscriptionId,
        scheduleId: p.scheduleId,
      },
    };
  },
});
export const authorizeWitnessRetention = queryGeneric({
  args: { capability: v.literal("renewal_witness_retain_v1"), scope },
  returns: v.union(
    v.null(),
    v.object({
      capability: v.literal("renewal_witness_retain_v1"),
      ...grantFields,
    }),
  ),
  handler: async (ctx, args) => {
    witnessControls.retainQueries++;
    const who = await ctx.auth.getUserIdentity();
    if (
      who?.tokenIdentifier !== observerIdentity.tokenIdentifier ||
      witnessControls.denyRetain ||
      !isDeepStrictEqual(args.scope, witnessControls.scope)
    )
      return null;
    const grant = {
      ...args,
      tokenIdentifier: who.tokenIdentifier,
      authorizationId: "test-witness-retention",
      authorizationRevision: 1,
      expiresAtMs: witnessControls.expiresAtMs,
    };
    witnessControls.onRetainGrant?.(grant, witnessControls.retainQueries);
    return grant;
  },
});
export const authorizeWitnessRead = queryGeneric({
  args: { capability: v.literal("renewal_witness_read_v1"), identity },
  returns: v.union(
    v.null(),
    v.object({
      capability: v.literal("renewal_witness_read_v1"),
      ...grantFields,
      witnessRowId: v.string(),
      payloadBinding: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    witnessControls.readQueries++;
    const who = await ctx.auth.getUserIdentity();
    if (
      !who ||
      !witnessControls.allowedReaders.includes(who.tokenIdentifier) ||
      witnessControls.denyRead ||
      !witnessControls.scope ||
      !isDeepStrictEqual(args.identity, witnessControls.scope.identity)
    )
      return null;
    const stored = await ctx.runQuery(
      components.betterStripe.renewalWitnesses.queries.readAuthorizedWitness,
      { identity: args.identity },
    );
    if (!stored) return null;
    const grant = {
      capability: args.capability,
      scope: structuredClone(witnessControls.scope),
      tokenIdentifier: who.tokenIdentifier,
      authorizationId: "test-witness-read",
      authorizationRevision: 1,
      expiresAtMs: witnessControls.expiresAtMs,
      witnessRowId: stored.descriptor.witnessRowId,
      payloadBinding: stored.descriptor.payloadBinding,
    };
    witnessControls.onReadGrant?.(grant, witnessControls.readQueries);
    return grant;
  },
});

export async function prepareWitnessObservation(
  h: Parameters<typeof prepareFreshObservation>[0],
  retained = false,
  withInvoices = false,
) {
  witnessControls.retainQueries = 0;
  witnessControls.readQueries = 0;
  witnessControls.denyRetain = false;
  witnessControls.denyRead = false;
  witnessControls.allowedReaders.splice(
    0,
    witnessControls.allowedReaders.length,
    observerIdentity.tokenIdentifier,
  );
  witnessControls.onRetainGrant = null;
  witnessControls.onReadGrant = null;
  const state = withInvoices
    ? await prepareInvoiceObservation(h, { retained })
    : await prepareFreshObservation(h, { active: true, retained });
  const invoiceProfile =
    "invoiceProfile" in state ? state.invoiceProfile : null;
  const record = JSON.parse(
    state.full.configure.operation.recordJSON,
  ).configureRecord;
  const scope: WitnessScope = {
    identity: {
      componentScope: state.entry.componentScope,
      witnessId: "witness-fixed-native-period",
      parentOperationId: state.parentOperationId,
      operationId: state.operationId,
    },
    providerScope: {
      mode: "platform",
      stripeAccount: null,
      livemode: false,
      customerAccountId: "acct_buyer",
      customerId: "cus_buyer",
      subscriptionId: "sub_original",
      scheduleId: "sub_sched_owned",
    },
    configureRequestBinding: record.request.requestIdentity.binding,
    observedItemId: "si_successor",
    nativePeriod: { start: 1771113600, end: 1771718400 },
  };
  witnessControls.scope = scope;
  witnessControls.expiresAtMs = Date.now() + 60000;
  const captureProfile = Object.freeze({
    freshProfile: state.profile,
    invoiceProfile,
    authorizationQuery: makeFunctionReference<"query">(
      "initialOwner:authorizeWitnessRetention",
    ),
  });
  const readProfile = Object.freeze({
    freshProfile: state.profile,
    invoiceProfile,
    authorizationQuery: makeFunctionReference<"query">(
      "initialOwner:authorizeWitnessRead",
    ),
  });
  witnessControls.captures.splice(
    0,
    witnessControls.captures.length,
    captureProfile,
  );
  witnessControls.readers.splice(
    0,
    witnessControls.readers.length,
    readProfile,
  );
  return {
    ...state,
    scope,
    captureProfile,
    readProfile,
    invoiceInventories: "inventories" in state ? state.inventories : null,
  };
}

type Harness = Parameters<typeof prepareWitnessObservation>[0];
type Prepared = Awaited<ReturnType<typeof prepareWitnessObservation>>;
type InvokeOptions = {
  identity?: typeof observerIdentity;
  before?: (ctx: GenericActionCtx<GenericDataModel>) => void;
};
export function witnessActorInput(
  state: Prepared,
  ctx: GenericActionCtx<GenericDataModel>,
) {
  return {
    actualActionCtx: ctx,
    parentOperationId: state.parentOperationId,
    operationId: state.operationId,
    witnessId: state.scope.identity.witnessId,
  };
}
export async function invokeWitnessCapture(
  h: Harness,
  state: Prepared,
  options: InvokeOptions = {},
) {
  let output!: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof captureFreshWitnessRenewalObservation>
      >["invoke"]
    >
  >;
  await h.inAnotherAction(async (ctx) => {
    options.before?.(ctx);
    const actor = await captureFreshWitnessRenewalObservation(
      h.sdk,
      witnessActorInput(state, ctx),
    );
    output = await actor.invoke();
  }, options.identity);
  assert(output);
  return output;
}
export async function invokeWitnessRead(
  h: Harness,
  state: Prepared,
  options: InvokeOptions = {},
) {
  let output!: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof captureHistoricalWitnessRenewalObservation>
      >["invoke"]
    >
  >;
  await h.inAnotherAction(async (ctx) => {
    options.before?.(ctx);
    const actor = await captureHistoricalWitnessRenewalObservation(
      h.sdk,
      witnessActorInput(state, ctx),
    );
    output = await actor.invoke();
  }, options.identity);
  assert(output);
  return output;
}
export function readStoredWitness(h: Harness, state: Prepared) {
  return h.ctx.runQuery(
    components.betterStripe.renewalWitnesses.queries.readAuthorizedWitness,
    { identity: state.scope.identity },
  );
}
export const witnessFixtureOptions = {
  identity: observerIdentity,
  hostQuery: authorizeWitnessObservation,
  targetInterval: "week" as const,
  hostWitnessRetainQuery: authorizeWitnessRetention,
  hostWitnessReadQuery: authorizeWitnessRead,
  hostInvoiceQuery: authorizeInvoices,
};
