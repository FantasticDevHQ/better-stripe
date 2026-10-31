import type { AttachRequest } from "./types.js";
import type { Diagnostics } from "./providerFailure.js";
import type { createOwnedTransportWithAttemptCapability } from "./fixedTransport.js";
import { need, stop } from "./initialActorData.js";

/** Invocation-local failure projection; no transport, Owner or Source mint. */
export function captureActorFailureControl(
  OWNER: { check(): unknown },
  activePair: ReturnType<typeof createOwnedTransportWithAttemptCapability>,
  request: AttachRequest,
) {
  const capability = activePair.capability,
    takeQuarantine = capability.takeFulfilledQuarantine;
  Object.freeze(request.payload);
  Object.freeze(request.requestIdentity);
  Object.freeze(request);
  OWNER.check();
  type Token = {
    invocation: object;
    phase: "read" | "post";
    ordinal: number;
    request: AttachRequest;
    diagnostics: Diagnostics;
  };
  const tokens = new WeakMap<object, Token>(),
    invocation = Object.freeze({});
  let phase = "unused";
  const tokenValue = (error: unknown) =>
    error !== null && (typeof error === "object" || typeof error === "function")
      ? tokens.get(error)
      : undefined;
  function consume(error: unknown, kind: "read" | "post") {
    OWNER.check();
    const value = tokenValue(error);
    if (
      error !== null &&
      (typeof error === "object" || typeof error === "function")
    )
      tokens.delete(error);
    if (
      !value ||
      value.invocation !== invocation ||
      value.phase !== kind ||
      phase !== (kind === "read" ? "failed" : "failed_post")
    )
      return null;
    phase = kind === "read" ? "consumed" : "consumed_post";
    const failure = Object.freeze({
      category: "provider_rejected",
      phase: kind,
      ordinal: value.ordinal,
      request: value.request,
      diagnostics: value.diagnostics,
      outcome: "unknown",
      operationalAuthority: false,
    });
    const out = Error("INITIAL_PROVIDER_REJECTED");
    Object.defineProperty(out, "failure", {
      value: failure,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return out;
  }
  return Object.freeze({
    takePostQuarantine(...args: unknown[]) {
      if (args.length !== 0) return null;
      return Reflect.apply(takeQuarantine, capability, []) as object | null;
    },
    begin() {
      OWNER.check();
      if (phase !== "unused") stop();
      if (capability.assertVirginAcquisition() !== true) {
        phase = "closed";
        stop();
      }
      OWNER.check();
      phase = "acquiring";
    },
    complete() {
      OWNER.check();
      if (phase !== "acquiring") stop();
      phase = "complete";
    },
    takeReadFailure() {
      OWNER.check();
      if (phase !== "acquiring") stop();
      const record = capability.consumeReadCatch();
      OWNER.check();
      if (record === null) {
        phase = "unsupported";
        return null;
      }
      need(
        record.phase === "read" &&
          Number.isSafeInteger(record.ordinal) &&
          record.ordinal >= 1 &&
          record.ordinal <= 43,
      );
      const token = Object.freeze(Object.create(null)) as object;
      tokens.set(
        token,
        Object.freeze({
          invocation,
          phase: "read",
          ordinal: record.ordinal,
          request,
          diagnostics: record.diagnostics,
        }),
      );
      phase = "failed";
      return token;
    },
    beginPost() {
      OWNER.check();
      if (phase !== "complete") stop();
      phase = "posting";
    },
    takePostFailure(actualReply: unknown) {
      OWNER.check();
      if (phase !== "posting") stop();
      const record = capability.consumePostCatch(actualReply);
      OWNER.check();
      if (record === null) {
        phase = "post_without_token";
        return null;
      }
      need(
        record.phase === "post" &&
          Number.isSafeInteger(record.ordinal) &&
          record.ordinal >= 1 &&
          record.ordinal <= 44,
      );
      const token = Object.freeze(Object.create(null)) as object;
      tokens.set(
        token,
        Object.freeze({
          invocation,
          phase: "post",
          ordinal: record.ordinal,
          request,
          diagnostics: record.diagnostics,
        }),
      );
      phase = "failed_post";
      return token;
    },
    forward(error: unknown) {
      OWNER.check();
      const value = tokenValue(error);
      return value &&
        value.invocation === invocation &&
        (phase === "failed" || phase === "failed_post")
        ? (error as object)
        : null;
    },
    consume(error: unknown) {
      return consume(error, "read");
    },
    consumePost(error: unknown) {
      return consume(error, "post");
    },
  });
}
