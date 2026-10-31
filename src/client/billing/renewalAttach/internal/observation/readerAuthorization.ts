import { closed, freeze } from "../c10/ownData.js";
import { rejectProxyJSON } from "../acquisition/rawWireSource.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import type { FunctionReference } from "convex/server";
import type { Component } from "../../../../helpers.js";
export const readerStop = (): never => {
  throw Error("OBSERVATION_HISTORY_READER_UNBOUND");
};
export function readerNeed(value: unknown): asserts value {
  if (!value) readerStop();
}
export function readerText(value: unknown, max = 255): string {
  readerNeed(
    typeof value === "string" && value.length > 0 && value.length <= max,
  );
  return value;
}
export type AuthorizationArgs = {
  componentScope: string;
  parentOperationId: string;
  operationId: string;
};
export type ObservationHistorySourceEntry = Readonly<{
  component: Component;
  componentScope: string;
  authorizationQuery: FunctionReference<
    "query",
    "public" | "internal",
    AuthorizationArgs,
    unknown
  >;
}>;
/** Detached bounded own DATA before another query or await can observe it. */
export function captureReaderQueryDATA<T>(raw: T): T {
  rejectProxyJSON(raw);
  const copy = renewalSnapshot(raw);
  readerNeed(new TextEncoder().encode(JSON.stringify(copy)).length <= 500000);
  matchConfigureDATA(raw, copy);
  return freeze(copy);
}
export function captureReaderAuthorization(
  raw: unknown,
  args: AuthorizationArgs,
  tokenIdentifier: string,
  now: number,
) {
  rejectProxyJSON(raw);
  const copy = renewalSnapshot(raw);
  readerNeed(new TextEncoder().encode(JSON.stringify(copy)).length <= 8192);
  matchConfigureDATA(raw, copy);
  const x = closed(copy, [
    "tokenIdentifier",
    "componentScope",
    "parentOperationId",
    "operationId",
    "providerScope",
    "authorizationId",
    "authorizationRevision",
    "expiresAtMs",
  ]);
  const p = closed(x.providerScope, [
    "mode",
    "stripeAccount",
    "livemode",
    "customerAccountId",
    "subscriptionId",
    "scheduleId",
  ]);
  readerNeed(
    x.tokenIdentifier === tokenIdentifier &&
      x.componentScope === args.componentScope &&
      x.parentOperationId === args.parentOperationId &&
      x.operationId === args.operationId,
  );
  readerNeed(
    p.mode === "platform" &&
      p.stripeAccount === null &&
      typeof p.livemode === "boolean",
  );
  readerNeed(
    typeof x.authorizationRevision === "number" &&
      Number.isSafeInteger(x.authorizationRevision) &&
      x.authorizationRevision > 0,
  );
  readerNeed(
    typeof x.expiresAtMs === "number" &&
      Number.isSafeInteger(x.expiresAtMs) &&
      x.expiresAtMs > now,
  );
  return freeze({
    ...args,
    tokenIdentifier: readerText(tokenIdentifier, 2048),
    providerScope: {
      mode: "platform" as const,
      stripeAccount: null,
      livemode: p.livemode,
      customerAccountId: readerText(p.customerAccountId),
      subscriptionId: readerText(p.subscriptionId),
      scheduleId: readerText(p.scheduleId),
    },
    authorizationId: readerText(x.authorizationId),
    authorizationRevision: x.authorizationRevision,
    expiresAtMs: x.expiresAtMs,
  });
}

/** Fresh query-only budget, including capture and idle time. Never an old write Owner. */
export function createObservationReaderLifetime() {
  let state: "running" | "closed" | "expired" = "running";
  const initial = { wallMs: Date.now(), ns: process.hrtime.bigint() };
  let last = initial;
  const valid = (s: typeof initial) =>
    Number.isSafeInteger(s.wallMs) &&
    s.wallMs >= 0 &&
    s.ns >= 0n &&
    s.ns <= 18446744073709551615n;
  readerNeed(valid(initial));
  let rejectExpiry!: (error: Error) => void;
  const expiry = new Promise<never>((_resolve, reject) => {
    rejectExpiry = reject;
  });
  void expiry.catch(() => {});
  function expire(): never {
    state = "expired";
    clearTimeout(timer);
    const error = Error("OBSERVATION_HISTORY_READER_EXPIRED");
    rejectExpiry(error);
    throw error;
  }
  const timer = setTimeout(() => {
    if (state === "running") {
      state = "expired";
      rejectExpiry(Error("OBSERVATION_HISTORY_READER_EXPIRED"));
    }
  }, 30000);
  timer.unref?.();
  function check() {
    if (state === "expired") throw Error("OBSERVATION_HISTORY_READER_EXPIRED");
    readerNeed(state === "running");
    const sample = { wallMs: Date.now(), ns: process.hrtime.bigint() };
    if (
      !valid(sample) ||
      sample.wallMs < last.wallMs ||
      sample.ns < last.ns ||
      sample.wallMs - initial.wallMs >= 30000 ||
      sample.ns - initial.ns >= 30000000000n
    )
      expire();
    last = sample;
    return sample;
  }
  function close() {
    if (state === "running") state = "closed";
    clearTimeout(timer);
  }
  async function owned<T>(
    work: () => T | PromiseLike<T>,
    guard: () => void,
  ): Promise<T> {
    check();
    guard();
    try {
      const pending = Promise.resolve().then(() => {
        check();
        guard();
        return work();
      });
      const result = await Promise.race([pending, expiry]);
      check();
      guard();
      return result;
    } catch (error) {
      close();
      throw error;
    }
  }
  return Object.freeze({ check, close, owned });
}
