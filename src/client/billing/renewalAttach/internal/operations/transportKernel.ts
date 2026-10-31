import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { rejectProxyJSON } from "../acquisition/rawWireSource.js";
import {
  closed,
  captureRequestAndReads,
  need,
  stop,
  freezeJSON,
  type AttachRequest,
  type ReadRow,
} from "./types.js";
import {
  safeDiagnostics,
  opaqueRecord,
  type Diagnostics,
} from "./providerFailure.js";
import { equal } from "../../../renewalAggregate/shared.js";
import {
  captureLegacyTransportSource,
  captureInitialTransportSource,
  checkTransportOwnerResult as checkOwnerResult,
} from "./transportCapture.js";

function validRead(
  row: ReadRow,
  method: unknown,
  path: unknown,
  body: unknown,
  options: unknown,
) {
  need(row && method === row.method && path === row.path && body === undefined);
  const value = closed(options, ["apiVersion", "maxNetworkRetries"]);
  need(
    value.apiVersion === row.options.apiVersion &&
      value.maxNetworkRetries === 0,
  );
}

export type PostDisposition =
  | "NOT_STARTED"
  | "PENDING"
  | "REJECTED"
  | "FULFILLED_UNVERIFIED"
  | "FULFILLED_SAFE";
type Attempt = Readonly<{
  generation: object;
  ordinal: number;
  kind: "read" | "post";
  resource: string;
  method: string;
  path: string;
  id: string;
}>;
export type Quarantine = Readonly<object>;
type Rejection = Readonly<{
  phase: "read";
  ordinal: number;
  diagnostics: Diagnostics;
}>;
const notStarted = (reason: string) =>
  Object.freeze({ outcome: "not_started" as const, reason });
const nativeResponsePrototype = Response.prototype,
  nativeStatusGetter = Object.getOwnPropertyDescriptor(
    nativeResponsePrototype,
    "status",
  )!.get!,
  apply = Reflect.apply;

function capturePostReply(reply: unknown) {
  rejectProxyJSON(reply, true);
  need(reply !== null && typeof reply === "object" && !Array.isArray(reply));
  const proto = Object.getPrototypeOf(reply);
  need(proto === Object.prototype || proto === null);
  const meta = Object.getOwnPropertyDescriptor(reply, "lastResponse");
  need(
    meta &&
      !meta.enumerable &&
      "value" in meta &&
      meta.value !== null &&
      typeof meta.value === "object",
  );
  const metadata: object = meta.value;
  need(!types.isProxy(metadata));
  const codes: unknown[] = [];
  for (const key of ["status", "statusCode"]) {
    const d = Object.getOwnPropertyDescriptor(metadata, key);
    if (!d) continue;
    need("value" in d);
    if (d.value !== undefined) codes.push(d.value);
  }
  if (Object.getPrototypeOf(metadata) === nativeResponsePrototype)
    codes.push(apply(nativeStatusGetter, metadata, []));
  need(
    codes.length > 0 &&
      codes.every(
        (x) =>
          typeof x === "number" &&
          Number.isInteger(x) &&
          x >= 200 &&
          x < 300 &&
          x === codes[0],
      ),
  );
  const statusCode = codes[0];
  need(typeof statusCode === "number");
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(reply)) {
    need(typeof key === "string");
    if (key === "lastResponse") continue;
    const d = Object.getOwnPropertyDescriptor(reply, key);
    need(d && d.enumerable && "value" in d);
    entries.push([key, d.value]);
  }
  return Object.freeze({
    body: requiredJSONSnapshot(Object.fromEntries(entries)),
    statusCode,
  });
}

type Association = Readonly<{
  operation: unknown;
  readPlan: unknown;
  delegate: unknown;
}>;
export function build(
  source: unknown,
  association?: Association,
  token?: object,
) {
  const b =
    token === undefined
      ? captureLegacyTransportSource(source)
      : captureInitialTransportSource(token, source);
  const generation = Object.freeze({});
  let ordinal = 0,
    index = 0,
    pending: Attempt | null = null,
    failedRead = false,
    consumedPost = false;
  let postState: PostDisposition = "NOT_STARTED",
    postAttempt: Attempt | null = null,
    rejectionSlot: { attempt: Attempt; record: Rejection } | null = null,
    lastFailedRead: Attempt | null = null,
    closedOwner = false,
    checking = false;
  function ownerGate() {
    if (closedOwner || checking) {
      closedOwner = true;
      stop();
    }
    checking = true;
    try {
      checkOwnerResult(Reflect.apply(b.check, b.owner, []));
      if (closedOwner) stop();
    } catch {
      closedOwner = true;
      stop();
    } finally {
      checking = false;
    }
  }
  function attempt(
    kind: "read" | "post",
    row: ReadRow | AttachRequest,
  ): Attempt {
    need(!pending && ordinal < 44);
    const value = Object.freeze({
      generation,
      ordinal: ++ordinal,
      kind,
      resource: kind === "read" && "resource" in row ? row.resource : "post",
      method: row.method,
      path: row.path,
      id: "id" in row ? row.id : b.request.payload.from_subscription,
    });
    pending = value;
    return value;
  }
  const own = (a: Attempt) => pending === a && a.generation === generation;
  const postCatchRecords = new WeakMap<
    object,
    Readonly<{ attempt: Attempt; diagnostics: Diagnostics }>
  >();
  let reservation = "unused",
    fulfilledSlot: Readonly<{
      attempt: Attempt;
      generation: object;
      quarantine: Quarantine;
    }> | null = null;
  async function rawRequest(
    method: unknown,
    path: unknown,
    body: unknown,
    options: unknown,
  ): Promise<unknown> {
    need(!failedRead && !consumedPost && !pending && index < b.plan.length);
    ownerGate();
    const row = b.plan[index];
    validRead(row, method, path, body, options);
    const a = attempt("read", row);
    let reply: unknown;
    try {
      reply = await Reflect.apply(b.send, b.delegate, [
        method,
        path,
        body,
        row.options,
      ]);
    } catch (error) {
      need(own(a));
      failedRead = true;
      lastFailedRead = a;
      let live = false;
      try {
        ownerGate();
        live = true;
      } catch {
        /* Retired errors are opaque. */
      }
      if (live && own(a))
        rejectionSlot = {
          attempt: a,
          record: opaqueRecord(
            {
              phase: "read",
              ordinal: a.ordinal,
              diagnostics: safeDiagnostics(error),
            } as const,
            "rawError",
            error,
          ),
        };
      pending = null;
      if (live) throw error;
      stop();
    }
    try {
      ownerGate();
      need(own(a));
    } catch {
      failedRead = true;
      pending = null;
      stop();
    }
    pending = null;
    index++;
    return reply;
  }
  async function postAttach(...args: unknown[]) {
    if (
      args.length ||
      consumedPost ||
      pending ||
      failedRead ||
      index !== b.plan.length
    )
      return notStarted("not_ready");
    try {
      ownerGate();
    } catch {
      return notStarted("owner_closed");
    }
    consumedPost = true;
    const request = b.request,
      a = attempt("post", request);
    postAttempt = a;
    postState = "PENDING";
    let reply: unknown;
    try {
      reply = await Reflect.apply(b.send, b.delegate, [
        request.method,
        request.path,
        request.payload,
        {
          apiVersion: request.apiVersion,
          idempotencyKey: request.key,
          maxNetworkRetries: 0,
        },
      ]);
    } catch (error) {
      postState = "REJECTED";
      let live = false;
      try {
        ownerGate();
        live = true;
      } catch {
        /* No late error reflection. */
      }
      const valid = own(a) && postAttempt === a,
        diagnostics =
          live && valid ? safeDiagnostics(error) : Object.freeze({});
      const record = opaqueRecord(
        {
          outcome: "provider_rejected",
          phase: "post",
          ordinal: a.ordinal,
          diagnostics,
        } as const,
        "rawError",
        error,
      );
      if (valid)
        postCatchRecords.set(
          record,
          Object.freeze({ attempt: a, diagnostics }),
        );
      pending = null;
      return record;
    }
    if (own(a) && postAttempt === a && a.generation === generation) {
      const q: object = Object.create(null);
      Object.defineProperty(q, "raw", {
        value: reply,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      Object.freeze(q);
      fulfilledSlot = Object.freeze({ attempt: a, generation, quarantine: q });
    }
    postState = "FULFILLED_UNVERIFIED";
    try {
      ownerGate();
      need(own(a) && postAttempt === a);
      const admitted = capturePostReply(reply);
      ownerGate();
      pending = null;
      postState = "FULFILLED_SAFE";
      return Object.freeze({
        outcome: "fulfilled_safe" as const,
        body: freezeJSON(admitted.body),
        statusCode: admitted.statusCode,
      });
    } catch {
      pending = null;
      return opaqueRecord(
        { outcome: "fulfilled_unverified" as const },
        "rawResponse",
        reply,
      );
    }
  }
  const transport = Object.freeze({
    readTransport: Object.freeze({ rawRequest }),
    postAttach,
    takeReadRejection(...args: unknown[]) {
      need(args.length === 0);
      const slot = rejectionSlot;
      rejectionSlot = null;
      if (
        !slot ||
        slot.attempt !== lastFailedRead ||
        slot.attempt.generation !== generation ||
        slot.attempt.kind !== "read"
      )
        return null;
      return slot.record;
    },
    postDisposition(...args: unknown[]): PostDisposition {
      need(args.length === 0);
      return postState;
    },
  });
  const capability = Object.freeze({
    assertSourceOperationBinding(
      operation: unknown,
      request: unknown,
      readPlan: unknown,
      delegate: unknown,
    ) {
      ownerGate();
      if (
        !association ||
        association.operation !== operation ||
        association.readPlan !== readPlan ||
        association.delegate !== delegate
      )
        return false;
      const current = captureRequestAndReads(request, readPlan);
      const matches =
        equal(current.request, b.request) &&
        current.plan.length === b.plan.length &&
        current.plan.every((row, index) => {
          const captured = b.plan[index];
          return (
            row.resource === captured.resource &&
            row.ordinal === captured.ordinal &&
            row.method === captured.method &&
            row.path === captured.path &&
            row.body === captured.body &&
            row.id === captured.id &&
            row.options.apiVersion === captured.options.apiVersion &&
            row.options.maxNetworkRetries === captured.options.maxNetworkRetries
          );
        });
      ownerGate();
      return matches;
    },
    takeFulfilledQuarantine(...args: unknown[]) {
      if (
        args.length !== 0 ||
        pending !== null ||
        fulfilledSlot === null ||
        fulfilledSlot.attempt !== postAttempt ||
        fulfilledSlot.generation !== generation ||
        postAttempt === null ||
        postAttempt.generation !== generation ||
        postAttempt.kind !== "post" ||
        (postState !== "FULFILLED_SAFE" && postState !== "FULFILLED_UNVERIFIED")
      )
        return null;
      const q = fulfilledSlot.quarantine;
      fulfilledSlot = null;
      return q;
    },
    assertVirginAcquisition(...args: unknown[]) {
      need(args.length === 0);
      try {
        ownerGate();
      } catch {
        return false;
      }
      if (
        reservation !== "unused" ||
        ordinal !== 0 ||
        index !== 0 ||
        pending ||
        failedRead ||
        lastFailedRead ||
        rejectionSlot ||
        consumedPost ||
        postAttempt ||
        postState !== "NOT_STARTED"
      ) {
        reservation = "invalid";
        return false;
      }
      reservation = "reserved";
      return true;
    },
    consumeReadCatch(...args: unknown[]) {
      need(args.length === 0);
      try {
        ownerGate();
      } catch {
        return null;
      }
      const slot = rejectionSlot;
      if (
        reservation !== "reserved" ||
        !failedRead ||
        pending ||
        !slot ||
        slot.attempt !== lastFailedRead ||
        slot.attempt.generation !== generation ||
        slot.attempt.kind !== "read" ||
        slot.attempt.ordinal > 43
      )
        return null;
      rejectionSlot = null;
      return Object.freeze({
        phase: "read" as const,
        ordinal: slot.attempt.ordinal,
        diagnostics: slot.record.diagnostics,
      });
    },
    consumePostCatch(actualReply: unknown) {
      need(arguments.length === 1);
      try {
        ownerGate();
      } catch {
        return null;
      }
      const stored =
        actualReply !== null &&
        (typeof actualReply === "object" || typeof actualReply === "function")
          ? postCatchRecords.get(actualReply)
          : undefined;
      if (
        reservation !== "reserved" ||
        !stored ||
        stored.attempt !== postAttempt ||
        stored.attempt.generation !== generation ||
        stored.attempt.kind !== "post" ||
        postState !== "REJECTED" ||
        pending ||
        stored.attempt.ordinal > 44
      )
        return null;
      postCatchRecords.delete(actualReply as object);
      return Object.freeze({
        phase: "post" as const,
        ordinal: stored.attempt.ordinal,
        diagnostics: stored.diagnostics,
      });
    },
  });
  return Object.freeze({ transport, capability });
}
