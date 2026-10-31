import Stripe from "stripe";
import { types } from "node:util";
import {
  COMPILED_FRESH_OBSERVATION_ENTRIES,
  COMPILED_OBSERVATION_HISTORY_ENTRIES,
  type FreshObservationProfile,
} from "../operations/sourceOperations.js";
import {
  readMaintainedRootComponent,
  captureInitialJournalSelection,
} from "../producer/classOwnedActionRoot.js";
import { readObservationInvocation } from "./invocation.js";
import { closed, freeze } from "../c10/ownData.js";
import {
  baseReadRows,
  couponReadRow,
  observationCouponIds,
  validateBaseRouting,
} from "./profile.js";
import { captureObservationReply, safeReadDiagnostics } from "./capture.js";
import type {
  ObservationReadRow,
  ObservationReads,
  ReadFailure,
} from "./types.js";

export function freshStop(): never {
  throw Error("FRESH_OBSERVATION_UNBOUND");
}
export function freshNeed(value: unknown): asserts value {
  if (!value) freshStop();
}
const method = Object.getOwnPropertyDescriptor(
  Stripe.prototype,
  "rawRequest",
)?.value;
const nativeThen = Promise.prototype.then;
export function captureFreshObservationProfile(
  root: object,
): FreshObservationProfile {
  if (COMPILED_FRESH_OBSERVATION_ENTRIES.length === 0) freshStop();
  const component = readMaintainedRootComponent(root);
  const candidates = COMPILED_FRESH_OBSERVATION_ENTRIES.filter((entry) => {
    freshNeed(!types.isProxy(entry));
    closed(entry, ["historyEntry", "readProfile", "coversObservation"]);
    return entry.historyEntry.component === component;
  });
  freshNeed(candidates.length === 1);
  const profile = candidates[0];
  freshNeed(
    Object.isFrozen(profile) &&
      profile.readProfile === "endive-schedule-first-44-v1" &&
      COMPILED_OBSERVATION_HISTORY_ENTRIES.includes(profile.historyEntry),
  );
  freshNeed(
    typeof profile.coversObservation === "function" &&
      !types.isProxy(profile.coversObservation),
  );
  return profile;
}
type Settlement = Readonly<{
  promise: object;
  kind: "fulfilled" | "rejected";
  value: unknown;
}>;
/** Actual fresh class selection and GET-only fixed rows. No caller transport or old lineage. */
export function captureFreshGetTransport(
  token: object,
  profile: FreshObservationProfile,
) {
  freshNeed(arguments.length === 2);
  const state = readObservationInvocation(token),
    captured = state.readCaptured();
  freshNeed(state.historyEntry === profile.historyEntry);
  const covers = profile.coversObservation;
  function profileGuard() {
    readObservationInvocation(token);
    freshNeed(
      COMPILED_FRESH_OBSERVATION_ENTRIES.includes(profile) &&
        COMPILED_FRESH_OBSERVATION_ENTRIES.filter(
          (e) => e.historyEntry === state.historyEntry,
        ).length === 1,
    );
    freshNeed(
      profile.historyEntry === state.historyEntry &&
        profile.coversObservation === covers &&
        profile.readProfile === "endive-schedule-first-44-v1",
    );
  }
  profileGuard();
  freshNeed(Reflect.apply(covers, profile, [captured.history.record]) === true);
  profileGuard();
  const selection = captureInitialJournalSelection(
    state.binding,
    "2026-09-30.endive",
  );
  const client = selection.select();
  freshNeed(
    client &&
      typeof client === "object" &&
      !types.isProxy(client) &&
      Object.getPrototypeOf(client) === Stripe.prototype &&
      !Object.prototype.hasOwnProperty.call(client, "rawRequest") &&
      typeof method === "function",
  );
  function guard() {
    profileGuard();
    selection.check();
    freshNeed(
      Object.getPrototypeOf(client) === Stripe.prototype &&
        !Object.prototype.hasOwnProperty.call(client, "rawRequest") &&
        Object.getOwnPropertyDescriptor(Stripe.prototype, "rawRequest")
          ?.value === method,
    );
  }
  guard();
  const base = baseReadRows(captured.history.record),
    bodies: unknown[] = [];
  let ordinal = 0,
    busy = false,
    ended = false;
  function expected() {
    if (ordinal < 4) return base[ordinal];
    const reads: ObservationReads = {
      schedule: bodies[0],
      subscription: bodies[1],
      targetPrice: bodies[2],
      billingCustomer: bodies[3],
      coupons: [],
    };
    validateBaseRouting(captured.history.record, reads);
    const ids = observationCouponIds(
      captured.history.record,
      reads.subscription,
    );
    freshNeed(ordinal - 4 < ids.length);
    return couponReadRow(ids[ordinal - 4], ordinal + 1);
  }
  return Object.freeze({
    guard,
    async read(
      raw: ObservationReadRow,
    ): Promise<
      | Readonly<{ kind: "fulfilled"; body: unknown }>
      | Readonly<{ kind: "provider_rejected"; failure: ReadFailure }>
    > {
      if (busy || ended) {
        ended = true;
        state.close();
        freshStop();
      }
      busy = true;
      try {
        guard();
        freshNeed(ordinal < 44 && !types.isProxy(raw));
        const row = expected(),
          actual = closed(raw, [
            "resource",
            "id",
            "ordinal",
            "method",
            "path",
            "body",
            "options",
          ]);
        freshNeed(!types.isProxy(actual.options));
        const options = closed(actual.options, [
          "apiVersion",
          "maxNetworkRetries",
        ]);
        freshNeed(
          actual.resource === row.resource &&
            actual.id === row.id &&
            actual.ordinal === row.ordinal &&
            actual.method === "GET" &&
            actual.path === row.path &&
            actual.body === undefined &&
            options.apiVersion === row.options.apiVersion &&
            options.maxNetworkRetries === 0,
        );
        await state.authorizeUnchanged();
        guard();
        ordinal++;
        let promise: object | null = null;
        const cell: { capsule: Settlement | null } = { capsule: null };
        const result: unknown = await state.owned(() => {
          const actualPromise: unknown = Reflect.apply(method, client, [
            "GET",
            row.path,
            undefined,
            row.options,
          ]);
          freshNeed(
            actualPromise &&
              typeof actualPromise === "object" &&
              !types.isProxy(actualPromise) &&
              types.isPromise(actualPromise),
          );
          promise = actualPromise;
          return Reflect.apply(nativeThen, actualPromise, [
            (value: unknown) =>
              (cell.capsule = Object.freeze({
                promise: actualPromise,
                kind: "fulfilled" as const,
                value,
              })),
            (value: unknown) =>
              (cell.capsule = Object.freeze({
                promise: actualPromise,
                kind: "rejected" as const,
                value,
              })),
          ]) as Promise<Settlement>;
        }, guard);
        guard();
        const capsule = cell.capsule;
        freshNeed(capsule && result === capsule && capsule.promise === promise);
        const settled: Settlement = capsule;
        if (settled.kind === "rejected") {
          ended = true;
          return Object.freeze({
            kind: "provider_rejected" as const,
            failure: freeze({
              category: "provider_rejected" as const,
              phase: "read" as const,
              resource: row.resource,
              ordinal: row.ordinal,
              request: {
                method: "GET" as const,
                path: row.path,
                apiVersion: row.options.apiVersion,
              },
              diagnostics: safeReadDiagnostics(settled.value),
              outcome: "unknown" as const,
              operationalAuthority: false as const,
            }),
          });
        }
        const body = captureObservationReply(settled.value);
        guard();
        bodies.push(body);
        return Object.freeze({ kind: "fulfilled" as const, body });
      } catch (error) {
        ended = true;
        state.close();
        throw error;
      } finally {
        busy = false;
      }
    },
  });
}
