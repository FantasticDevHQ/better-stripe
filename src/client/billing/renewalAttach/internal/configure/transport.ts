import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import { captureAdmittedConfigureWriteFrame } from "../producer/configureWriteFactory.js";
import { closed } from "../operations/types.js";
import { equal } from "../../../renewalAggregate/shared.js";
import {
  loadConfigureWriteTransportSource,
  loadConfigureReplayTransportSource,
} from "../operations/sourceOperations.js";
import { captureConfigureRequest } from "./output.js";
import { captureConfigureReply, configureDiagnostics } from "./capture.js";
import {
  capturePlan,
  samePlan,
  ownMethod,
  need,
  stop,
  type Row,
} from "./request.js";
import type { Diagnostics } from "../operations/providerFailure.js";

type Fact = Readonly<{
  phase: "read" | "post";
  resource: string;
  ordinal: number;
  diagnostics: Diagnostics;
}>;
export type Disposition =
  | "NOT_STARTED"
  | "PENDING"
  | "REJECTED"
  | "FULFILLED_UNVERIFIED"
  | "FULFILLED_SAFE";
function build(load: () => unknown) {
  OWNER.check();
  const raw = load();
  OWNER.check();
  return configureWriteKernel(raw, OWNER);
}
function configureWriteKernel(
  raw: unknown,
  owner: typeof OWNER,
  guard?: () => void,
) {
  need(!types.isProxy(raw));
  const frame = closed(raw, [
    "owner",
    "operation",
    "request",
    "readPlan",
    "delegate",
  ]);
  need(frame.owner === owner);
  const operation = frame.operation,
    readPlanReference = frame.readPlan,
    delegate = frame.delegate;
  const request = captureConfigureRequest(frame.request),
    plan = capturePlan(readPlanReference),
    method = ownMethod(delegate, "rawRequest"),
    generation = Object.freeze({});
  let phase = "unused",
    index = 0,
    closedOwner = false,
    checking = false,
    dispatching = false,
    postState: Disposition = "NOT_STARTED";
  type Attempt = Readonly<{
    generation: object;
    ordinal: number;
    phase: "read" | "post";
    resource: string;
    promise: Promise<unknown>;
  }>;
  let pending: Attempt | null = null,
    readCatch: { attempt: Attempt; fact: Fact } | null = null,
    lastRead: Attempt | null = null,
    postAttempt: Attempt | null = null;
  const postCatches = new WeakMap<object, { attempt: Attempt; fact: Fact }>(),
    notStarted = new WeakSet<object>();
  let _quarantine: { attempt: Attempt; raw: unknown } | null = null;
  function gate() {
    if (closedOwner || checking) {
      closedOwner = true;
      stop();
    }
    checking = true;
    try {
      guard?.();
      owner.check();
      guard?.();
      if (closedOwner) stop();
    } catch {
      closedOwner = true;
      stop();
    } finally {
      checking = false;
    }
  }
  const live = () => {
    try {
      gate();
      return true;
    } catch {
      return false;
    }
  };
  const valid = (a: Attempt) => pending === a && a.generation === generation;
  function start(kind: "read" | "post", resource: string, args: unknown[]) {
    need(pending === null && !dispatching);
    // A synchronous throw or non-Promise result is not an actual asynchronous catch.
    let promise: unknown;
    dispatching = true;
    try {
      promise = Reflect.apply(method, delegate, args);
    } finally {
      dispatching = false;
    }
    need(types.isPromise(promise));
    const attempt = Object.freeze({
      generation,
      ordinal: index + 1,
      phase: kind,
      resource,
      promise: promise as Promise<unknown>,
    });
    need(attempt.ordinal <= (kind === "read" ? 44 : 45));
    pending = attempt;
    return attempt;
  }
  const readTransport = Object.freeze({
    async rawRequest(
      verb: "GET",
      path: string,
      body: undefined,
      options: unknown,
    ): Promise<unknown> {
      need(arguments.length === 4);
      gate();
      need(
        phase === "reserved" &&
          pending === null &&
          !dispatching &&
          index < plan.length,
      );
      const row = plan[index];
      need(!types.isProxy(options));
      const o = closed(options, ["apiVersion", "maxNetworkRetries"]);
      need(
        verb === row.method &&
          path === row.path &&
          body === undefined &&
          o.apiVersion === row.options.apiVersion &&
          o.maxNetworkRetries === 0,
      );
      const a = start("read", row.resource, [verb, path, body, row.options]);
      let reply: unknown;
      try {
        reply = await a.promise;
      } catch (error) {
        phase = "failed";
        lastRead = a;
        if (live() && valid(a))
          readCatch = {
            attempt: a,
            fact: Object.freeze({
              phase: "read",
              resource: a.resource,
              ordinal: a.ordinal,
              diagnostics: configureDiagnostics(error),
            }),
          };
        pending = null;
        return stop();
      }
      gate();
      need(valid(a));
      pending = null;
      index++;
      if (index === plan.length) phase = "readclosed";
      return reply;
    },
  });
  const transport = Object.freeze({
    readTransport,
    postDisposition(): Disposition {
      need(arguments.length === 0);
      return postState;
    },
    async postConfigure() {
      need(arguments.length === 0);
      if (
        phase !== "readclosed" ||
        pending !== null ||
        postState !== "NOT_STARTED" ||
        !live()
      ) {
        const reply = Object.freeze({ outcome: "not_started" as const });
        notStarted.add(reply);
        return reply;
      }
      phase = "posting";
      // Mark mutation uncertainty before invoking the actual stock delegate.
      postState = "PENDING";
      let a: Attempt;
      try {
        a = start("post", "configure", [
          request.method,
          request.path,
          request.payload,
          {
            apiVersion: request.apiVersion,
            idempotencyKey: request.key,
            maxNetworkRetries: 0,
          },
        ]);
      } catch {
        phase = "failed";
        return Object.freeze({ outcome: "post_unknown" as const });
      }
      postAttempt = a;
      let reply: unknown;
      try {
        reply = await a.promise;
      } catch (error) {
        postState = "REJECTED";
        phase = "failed";
        const record = Object.freeze({ outcome: "provider_rejected" as const });
        if (live() && valid(a))
          postCatches.set(record, {
            attempt: a,
            fact: Object.freeze({
              phase: "post",
              resource: "configure",
              ordinal: a.ordinal,
              diagnostics: configureDiagnostics(error),
            }),
          });
        pending = null;
        return record;
      }
      if (valid(a) && postAttempt === a)
        _quarantine = { attempt: a, raw: reply };
      postState = "FULFILLED_UNVERIFIED";
      phase = "fulfilled";
      try {
        gate();
        need(valid(a));
        const admitted = captureConfigureReply(reply);
        gate();
        pending = null;
        postState = "FULFILLED_SAFE";
        return Object.freeze({
          outcome: "fulfilled_safe" as const,
          body: admitted.body,
          transport: admitted.transport,
        });
      } catch {
        pending = null;
        return Object.freeze({ outcome: "fulfilled_unverified" as const });
      }
    },
  });
  const capability = Object.freeze({
    assertSourceOperationBinding(
      actualOperation: unknown,
      originalRequest: unknown,
      actualReadPlan: unknown,
      actualDelegate: unknown,
      originalMethod: unknown,
      expected: readonly Row[],
    ) {
      need(arguments.length === 6);
      gate();
      if (
        phase !== "unused" ||
        operation !== actualOperation ||
        actualReadPlan !== readPlanReference ||
        actualDelegate !== delegate ||
        originalMethod !== method
      ) {
        phase = "invalid";
        return false;
      }
      const matches =
        equal(request, captureConfigureRequest(originalRequest)) &&
        samePlan(plan, capturePlan(actualReadPlan)) &&
        samePlan(plan, expected);
      gate();
      phase = matches ? "bound" : "invalid";
      return matches;
    },
    reserveAcquisition() {
      need(arguments.length === 0);
      gate();
      if (phase !== "bound" || index !== 0 || pending !== null) return false;
      phase = "reserved";
      return true;
    },
    consumeReadCatch() {
      need(arguments.length === 0);
      if (!live()) return null;
      const slot = readCatch;
      if (
        !slot ||
        slot.attempt !== lastRead ||
        slot.attempt.generation !== generation ||
        pending !== null ||
        phase !== "failed"
      )
        return null;
      readCatch = null;
      return slot.fact;
    },
    consumePostCatch(actualReply: unknown) {
      need(arguments.length === 1);
      if (!live()) return null;
      const slot =
        actualReply !== null && typeof actualReply === "object"
          ? postCatches.get(actualReply)
          : undefined;
      if (
        !slot ||
        slot.attempt !== postAttempt ||
        slot.attempt.generation !== generation ||
        pending !== null ||
        postState !== "REJECTED"
      )
        return null;
      postCatches.delete(actualReply as object);
      return slot.fact;
    },
    consumeNotStarted(actualReply: unknown) {
      need(arguments.length === 1);
      if (
        actualReply === null ||
        typeof actualReply !== "object" ||
        !notStarted.has(actualReply) ||
        postState !== "NOT_STARTED"
      )
        return false;
      notStarted.delete(actualReply);
      return true;
    },
    // No Owner sample/callback/reflection here: final actor gate immediately precedes this.
    discardFulfilledQuarantine() {
      _quarantine = null;
    },
  });
  return Object.freeze({ transport, capability });
}
export function createConfigureWriteTransport() {
  need(arguments.length === 0);
  return build(loadConfigureWriteTransportSource);
}
export function createConfigureReplayTransport() {
  need(arguments.length === 0);
  return build(loadConfigureReplayTransportSource);
}

/** Actual completed preflight custody only; no caller-supplied frame or Owner. */
export function createAdmittedConfigureWriteTransport(token: object) {
  const source = captureAdmittedConfigureWriteFrame(token, arguments.length);
  const pair = configureWriteKernel(source.frame, source.owner, source.guard);
  need(
    pair.capability.assertSourceOperationBinding(
      token,
      source.record.request,
      source.frame.readPlan,
      source.frame.delegate,
      source.frame.delegate.rawRequest,
      source.expected,
    ),
  );
  need(pair.capability.reserveAcquisition());
  source.guard();
  return Object.freeze({ ...pair, ...source });
}
