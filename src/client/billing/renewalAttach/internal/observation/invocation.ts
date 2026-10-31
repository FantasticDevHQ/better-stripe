import { types } from "node:util";
import {
  getFunctionAddress,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import { COMPILED_OBSERVATION_HISTORY_ENTRIES } from "../operations/sourceOperations.js";
import {
  readMaintainedRootComponent,
  captureMaintainedJournalBinding,
  readCheckedJournalActionRPC,
} from "../producer/classOwnedActionRoot.js";
import { closed, freeze } from "../c10/ownData.js";
import {
  object,
  matchConfigureDATA,
} from "../producer/configureJournalData.js";
import { captureRetainedObservationHistory } from "./history.js";
import {
  readerNeed as need,
  readerText as text,
  readerStop,
  captureReaderAuthorization,
  createObservationReaderLifetime,
  captureReaderQueryDATA,
} from "./readerAuthorization.js";

import type { ObservationHistorySourceEntry } from "./readerAuthorization.js";
type CapturedHistory = Readonly<{
  history: Awaited<ReturnType<typeof captureRetainedObservationHistory>>;
  authorization: ReturnType<typeof captureReaderAuthorization>;
}>;
export interface ObservationInvocationState {
  readonly binding: object;
  readonly historyEntry: ObservationHistorySourceEntry;
  guard(): void;
  check(): { wallMs: number; ns: bigint };
  close(): void;
  owned<T>(work: () => T | PromiseLike<T>, extra?: () => void): Promise<T>;
  captureHistory(): Promise<CapturedHistory>;
  authorizeUnchanged(): Promise<ReturnType<typeof captureReaderAuthorization>>;
  readCaptured(): CapturedHistory;
}
const invocations = new WeakMap<object, ObservationInvocationState>();
/** Cleanup does not need a still-valid context and cannot mint or read authority. */
export function closeObservationInvocation(token: unknown): void {
  if (token !== null && typeof token === "object")
    invocations.get(token)?.close();
}
/** Actual private invocation identity only. DATA cannot register a grant. */
export function readObservationInvocation(
  token: unknown,
): ObservationInvocationState {
  need(token !== null && typeof token === "object");
  const state = invocations.get(token);
  need(state);
  state.guard();
  return state;
}

/** One fresh lifetime and actual class/Action binding, shared by private wrappers. */
export async function captureObservationInvocation(
  actualRoot: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  if (COMPILED_OBSERVATION_HISTORY_ENTRIES.length === 0) readerStop();
  const component = readMaintainedRootComponent(actualRoot);
  const matches = COMPILED_OBSERVATION_HISTORY_ENTRIES.filter(
    (e) => e.component === component,
  );
  need(matches.length === 1);
  const entry = matches[0];
  closed(entry, ["component", "componentScope", "authorizationQuery"]);
  need(Object.isFrozen(entry));
  need(!types.isProxy(raw));
  const input = closed(raw, [
    "actualActionCtx",
    "operationId",
    "parentOperationId",
  ]);
  const args = freeze({
    componentScope: text(entry.componentScope),
    operationId: text(input.operationId),
    parentOperationId: text(input.parentOperationId),
  });
  need(args.operationId !== args.parentOperationId);
  need(
    input.actualActionCtx &&
      typeof input.actualActionCtx === "object" &&
      !types.isProxy(input.actualActionCtx),
  );
  const ctx = input.actualActionCtx as GenericActionCtx<GenericDataModel>;
  const auth = ctx.auth,
    getIdentity = auth?.getUserIdentity;
  need(
    auth &&
      !types.isProxy(auth) &&
      typeof getIdentity === "function" &&
      !types.isProxy(getIdentity),
  );
  const captured = {
    query: ctx.runQuery,
    mutation: ctx.runMutation,
    meta: ctx.meta,
    metadata: ctx.meta?.getFunctionMetadata,
  };
  const q = component.renewalOperations.queries;
  const references = () => {
    const current = component.renewalOperations.queries;
    return [
      current.loadAuthorizedOperation,
      current.readAttempt,
      current.readStageEvent,
      current.readProviderAcknowledgement,
    ];
  };
  const refs = {
    load: q.loadAuthorizedOperation,
    attempt: q.readAttempt,
    event: q.readStageEvent,
    acknowledgement: q.readProviderAcknowledgement,
  };
  const addresses = references().map((ref) =>
    JSON.stringify(getFunctionAddress(ref)),
  );
  const authAddress = JSON.stringify(
    getFunctionAddress(entry.authorizationQuery),
  );
  const lifetime = createObservationReaderLifetime();
  let binding: object | null = null;
  let authorizedUntil: number | null = null;
  function guard() {
    if (authorizedUntil !== null)
      need(lifetime.check().wallMs < authorizedUntil);
    need(readMaintainedRootComponent(actualRoot) === component);
    need(
      COMPILED_OBSERVATION_HISTORY_ENTRIES.filter(
        (e) => e.component === component,
      ).length === 1 && COMPILED_OBSERVATION_HISTORY_ENTRIES.includes(entry),
    );
    need(
      ctx.auth === auth &&
        auth.getUserIdentity === getIdentity &&
        ctx.runQuery === captured.query &&
        ctx.runMutation === captured.mutation &&
        ctx.meta === captured.meta &&
        ctx.meta.getFunctionMetadata === captured.metadata,
    );
    need(
      JSON.stringify(getFunctionAddress(entry.authorizationQuery)) ===
        authAddress,
    );
    references().forEach((ref, index) =>
      need(JSON.stringify(getFunctionAddress(ref)) === addresses[index]),
    );
    if (binding) {
      const rpc = readCheckedJournalActionRPC(binding);
      need(
        rpc.receiver === ctx &&
          rpc.component === component &&
          rpc.operationId === args.operationId &&
          rpc.runQuery === captured.query &&
          rpc.runMutation === captured.mutation,
      );
    }
  }
  const owned = <T>(work: () => T | PromiseLike<T>) =>
    lifetime.owned(work, guard);
  try {
    binding = await owned(() =>
      captureMaintainedJournalBinding(actualRoot, {
        actualActionCtx: ctx,
        operationId: args.operationId,
      }),
    );
    guard();
  } catch (error) {
    lifetime.close();
    throw error;
  }
  async function authorize() {
    const who = await owned(() => getIdentity.call(auth));
    need(who && !types.isProxy(who));
    const token = Object.getOwnPropertyDescriptor(who, "tokenIdentifier");
    need(token && token.enumerable && "value" in token);
    const tokenIdentifier = text(token.value, 2048);
    const reply: unknown = await owned(() =>
      captured.query.call(ctx, entry.authorizationQuery, args),
    );
    return captureReaderAuthorization(
      reply,
      args,
      tokenIdentifier,
      lifetime.check().wallMs,
    );
  }
  async function stage(operationId: string) {
    const operation: unknown = captureReaderQueryDATA(
      await owned(() => captured.query.call(ctx, refs.load, { operationId })),
    );
    const load = object(operation),
      active = object(load.activeAttempt);
    const attemptId = text(active.attemptId);
    const attempt: unknown = captureReaderQueryDATA(
      await owned(() =>
        captured.query.call(ctx, refs.attempt, { operationId, attemptId }),
      ),
    );
    const manifest = closed(attempt, ["reservation", "events"]);
    need(Array.isArray(manifest.events) && manifest.events.length <= 3);
    const count = manifest.events.length;
    const events = [];
    for (let index = 0; index < count; index++) {
      const sequence: 1 | 2 | 3 = index === 0 ? 1 : index === 1 ? 2 : 3;
      events.push(
        captureReaderQueryDATA(
          await owned(() =>
            captured.query.call(ctx, refs.event, {
              operationId,
              attemptId,
              sequence,
            }),
          ),
        ),
      );
    }
    const acknowledgement: unknown = captureReaderQueryDATA(
      await owned(() =>
        captured.query.call(ctx, refs.acknowledgement, { operationId }),
      ),
    );
    return { operation, attempt, events, acknowledgement };
  }
  let capturedHistory: CapturedHistory | null = null;
  let used = false;
  async function captureHistory(): Promise<CapturedHistory> {
    need(!used);
    used = true;
    lifetime.check();
    guard();
    const authorization = await authorize();
    authorizedUntil = authorization.expiresAtMs;
    const parent = await stage(args.parentOperationId),
      configure = await stage(args.operationId);
    const history = await owned(() =>
      captureRetainedObservationHistory({ parent, configure }),
    );
    const receipt = history.attachmentReceipt;
    matchConfigureDATA(authorization.providerScope, {
      mode: "platform",
      stripeAccount: null,
      livemode: receipt.livemode,
      customerAccountId: receipt.customerAccountId,
      subscriptionId: receipt.subscriptionId,
      scheduleId: receipt.scheduleId,
    });
    capturedHistory = Object.freeze({ history, authorization });
    return capturedHistory;
  }
  async function authorizeUnchanged() {
    need(capturedHistory);
    const final = await authorize();
    matchConfigureDATA(final, capturedHistory.authorization);
    need(lifetime.check().wallMs < capturedHistory.authorization.expiresAtMs);
    guard();
    return final;
  }
  need(binding);
  const token = Object.freeze({});
  invocations.set(
    token,
    Object.freeze({
      binding,
      historyEntry: entry,
      guard() {
        lifetime.check();
        guard();
      },
      check: lifetime.check,
      close: lifetime.close,
      owned<T>(work: () => T | PromiseLike<T>, extra?: () => void) {
        return lifetime.owned(work, () => {
          guard();
          extra?.();
        });
      },
      captureHistory,
      authorizeUnchanged,
      readCaptured() {
        lifetime.check();
        guard();
        need(capturedHistory);
        return capturedHistory;
      },
    }),
  );
  return token;
}
