import { getConvexSize, type Value } from "convex/values";
import {
  eventDigest,
  objectNode,
  scalarNode,
  type CapturedNode,
} from "../client/billing/renewalAttach/internal/c10/eventCodec.js";
import { renewalSnapshot } from "../client/billing/renewalReplacementSnapshot.js";

function stop(): never {
  throw Error("RENEWAL_JOURNAL_JSON_STOP");
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
/** Intrinsic V2 policy DATA only; full C1/C2 validation is an async boundary. */
function validateAttachTimingPolicy(value: Record<string, unknown>): void {
  const policy = value.timingPolicy;
  const dispatch = value.dispatch;
  const source = value.attachRequest;
  if (
    value.stage !== "attach" ||
    Object.prototype.hasOwnProperty.call(value, "basis") ||
    !Object.prototype.hasOwnProperty.call(value, "timingPolicy") ||
    !record(policy) ||
    !record(dispatch) ||
    !record(source) ||
    !record(source.preparation) ||
    !record(source.preparation.expected)
  )
    stop();
  const fields = [
    "version",
    "firstDispatchedAt",
    "periodStart",
    "periodEnd",
    "workEndWallMs",
    "endWallMs",
  ];
  const keys = Object.keys(policy);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    stop();
  const {
    firstDispatchedAt,
    periodStart,
    periodEnd,
    workEndWallMs,
    endWallMs,
  } = policy;
  const integer = (candidate: unknown): candidate is number =>
    typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0;
  if (
    policy.version !== 1 ||
    !integer(firstDispatchedAt) ||
    !integer(periodStart) ||
    !integer(periodEnd) ||
    !integer(workEndWallMs) ||
    !integer(endWallMs) ||
    periodEnd <= periodStart ||
    endWallMs < workEndWallMs ||
    firstDispatchedAt !== dispatch.firstDispatchedAt ||
    firstDispatchedAt !== source.firstDispatchedAt ||
    periodStart !== source.preparation.expected.periodStart ||
    periodEnd !== source.preparation.expected.periodEnd
  )
    stop();
}

/** Canonical immutable authorization DATA only, never Source or provider proof. */
export function canonicalJournalRecord(raw: string) {
  try {
    if (raw.length > 500000) stop();
    const parsed: unknown = JSON.parse(raw);
    const value = renewalSnapshot(parsed);
    if (
      !record(value) ||
      (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    )
      stop();
    if (value.schemaVersion === 2) validateAttachTimingPolicy(value);
    const authorization = value.authorization;
    if (
      !record(authorization) ||
      !text(authorization.scope) ||
      !text(authorization.id) ||
      typeof authorization.revision !== "number" ||
      !Number.isSafeInteger(authorization.revision) ||
      authorization.revision < 1 ||
      !text(value.logicalOperationId) ||
      !text(value.requestBinding)
    )
      stop();
    const json = JSON.stringify(value);
    if (json.length > 500000 || new TextEncoder().encode(json).length > 500000)
      stop();
    const normalized = {
      json,
      authorizationScope: authorization.scope,
      authorizationId: authorization.id,
      authorizationRevision: authorization.revision,
      logicalOperationId: value.logicalOperationId,
      requestBinding: value.requestBinding,
    };
    return value.schemaVersion === 2
      ? Object.freeze({ ...normalized, recordVersion: 2 as const })
      : Object.freeze(normalized);
  } catch {
    return stop();
  }
}

/** Complete immutable reservation DATA. This does not validate a live Owner. */
export function journalReservationMaterial(
  full: ReturnType<typeof canonicalJournalRecord>,
) {
  const value: unknown = JSON.parse(full.json);
  if (!record(value)) stop();
  const dispatch = value.dispatch;
  const account = value.account;
  const basis = value.basis;
  if (
    (value.stage !== "attach" && value.stage !== "configure") ||
    !record(dispatch) ||
    !text(dispatch.key) ||
    typeof dispatch.firstDispatchedAt !== "number" ||
    !Number.isSafeInteger(dispatch.firstDispatchedAt) ||
    dispatch.firstDispatchedAt < 0 ||
    !text(value.apiVersion) ||
    dispatch.apiVersion !== value.apiVersion ||
    dispatch.method !== "POST" ||
    !text(dispatch.path) ||
    !record(dispatch.payload) ||
    !record(account) ||
    (value.schemaVersion !== 2 && !record(basis)) ||
    (account.mode !== "platform" && account.mode !== "connected") ||
    dispatch.scope !== account.mode ||
    typeof account.livemode !== "boolean" ||
    (account.mode === "platform"
      ? account.stripeAccount !== null
      : !text(account.stripeAccount))
  )
    stop();
  admitJournalStrings([dispatch.key, value.apiVersion]);
  const common = Object.freeze({
    stage: value.stage,
    key: dispatch.key,
    apiVersion: value.apiVersion,
    firstDispatchedAt: dispatch.firstDispatchedAt,
    accountJSON: JSON.stringify(renewalSnapshot(account)),
  });
  if (value.schemaVersion === 2) {
    if (value.stage !== "attach") stop();
    validateAttachTimingPolicy(value);
    return Object.freeze({
      ...common,
      stage: "attach" as const,
      recordVersion: 2 as const,
      timingPolicyJSON: JSON.stringify(renewalSnapshot(value.timingPolicy)),
    });
  }
  return Object.freeze({
    ...common,
    basisJSON: JSON.stringify(renewalSnapshot(basis)),
  });
}

/** Canonical six-field basis DATA and exact original-policy projection only. */
export function canonicalInitialBasis(policyJSON: string, basisJSON: string) {
  try {
    function capture(raw: string) {
      if (raw.length > 500000) throw Error();
      const parsed: unknown = JSON.parse(raw);
      const value = renewalSnapshot(parsed);
      const json = JSON.stringify(value);
      if (
        json.length > 500000 ||
        new TextEncoder().encode(json).length > 500000
      )
        throw Error();
      if (!record(value)) throw Error();
      return { value, json };
    }
    const policy = capture(policyJSON);
    const basis = capture(basisJSON);
    const policyKeys = [
      "version",
      "firstDispatchedAt",
      "periodStart",
      "periodEnd",
      "workEndWallMs",
      "endWallMs",
    ];
    const basisKeys = [
      "startWallMs",
      "startNsDecimal",
      "workEndWallMs",
      "workEndNsDecimal",
      "endWallMs",
      "endNsDecimal",
    ];
    if (
      Object.keys(policy.value).length !== policyKeys.length ||
      Object.keys(policy.value).some((key) => !policyKeys.includes(key)) ||
      Object.keys(basis.value).length !== basisKeys.length ||
      Object.keys(basis.value).some((key) => !basisKeys.includes(key))
    )
      throw Error();
    const integer = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const { firstDispatchedAt, periodStart, periodEnd } = policy.value;
    const policyWork = policy.value.workEndWallMs;
    const policyEnd = policy.value.endWallMs;
    const { startWallMs, workEndWallMs, endWallMs } = basis.value;
    if (
      policy.value.version !== 1 ||
      !integer(firstDispatchedAt) ||
      !integer(periodStart) ||
      !integer(periodEnd) ||
      periodEnd <= periodStart ||
      !integer(policyWork) ||
      !integer(policyEnd) ||
      policyEnd < policyWork ||
      !integer(startWallMs) ||
      !integer(workEndWallMs) ||
      !integer(endWallMs) ||
      startWallMs >= workEndWallMs ||
      workEndWallMs !== policyWork ||
      endWallMs !== policyEnd
    )
      throw Error();
    function u64(value: unknown): bigint {
      if (
        typeof value !== "string" ||
        value.length > 20 ||
        !/^(0|[1-9][0-9]*)$/.test(value)
      )
        throw Error();
      const number = BigInt(value);
      if (number > 18446744073709551615n) throw Error();
      return number;
    }
    const startNs = u64(basis.value.startNsDecimal);
    const workNs = u64(basis.value.workEndNsDecimal);
    const endNs = u64(basis.value.endNsDecimal);
    const workProjection =
      startNs + (BigInt(workEndWallMs) - BigInt(startWallMs)) * 1000000n;
    const endProjection =
      startNs + (BigInt(endWallMs) - BigInt(startWallMs)) * 1000000n;
    if (
      workNs !== workProjection ||
      endNs !== endProjection ||
      startNs >= workNs ||
      workNs > endNs
    )
      throw Error();
    return Object.freeze({ policyJSON: policy.json, basisJSON: basis.json });
  } catch {
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  }
}

/** Existing C10 hash domain and whole budgets, for DATA consistency only. */
export async function canonicalJournalEvent(sequence: number, raw: string) {
  try {
    if (sequence !== 1 && sequence !== 2 && sequence !== 3) throw Error();
    if (raw.length > 500000) throw Error();
    const parsed: unknown = JSON.parse(raw);
    const value = renewalSnapshot(parsed);
    const json = JSON.stringify(value);
    if (json.length > 500000 || new TextEncoder().encode(json).length > 500000)
      throw Error();
    function capture(value: unknown): CapturedNode {
      if (value === null || typeof value !== "object") return scalarNode(value);
      if (Array.isArray(value))
        return Object.freeze({
          kind: "array" as const,
          entries: Object.freeze(
            value.map((item, index) =>
              Object.freeze([String(index), capture(item)] as const),
            ),
          ),
        });
      return objectNode(
        Object.entries(value).map(
          ([key, item]) => [key, capture(item)] as const,
        ),
      );
    }
    const binding = await eventDigest(
      objectNode([
        ["sequence", scalarNode(sequence)],
        ["data", capture(value)],
      ]),
    );
    return Object.freeze({ sequence, binding, json });
  } catch {
    throw Error("RENEWAL_JOURNAL_CONFLICT");
  }
}

/** Journal receiver boundary: exactly 1 MiB fits; strictly greater refuses. */
export function admitJournalValue(value: Value): void {
  try {
    if (getConvexSize(value) > 1048576) throw Error();
  } catch {
    throw Error("RENEWAL_JOURNAL_LIMIT");
  }
}

/** Admit extracted database strings without changing the retained JSON model. */
export function admitJournalStrings(values: readonly string[]): void {
  for (const value of values) {
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff))
          throw Error("RENEWAL_JOURNAL_ENCODING");
        index++;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        throw Error("RENEWAL_JOURNAL_ENCODING");
      }
    }
  }
}
