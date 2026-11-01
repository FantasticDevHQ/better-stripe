import Stripe from "stripe";
import { getFunctionAddress } from "convex/server";
import {
  createInvoiceReadPlan,
  InvoiceAcquisitionStop,
} from "./invoicePlan.js";
import {
  createInvoiceAuthorization,
  invoiceProfileGuard,
} from "./invoiceAuthorization.js";
import type { InvoiceObservationProfile } from "../operations/sourceOperations.js";
import type { InvoiceContextV1 } from "../../../renewalObservation/evidence-v1-types.js";
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
import { captureReaderQueryDATA } from "./readerAuthorization.js";
import { closed, freeze } from "../c10/ownData.js";
import {
  baseReadRows,
  couponReadRow,
  observationCouponIds,
  validateBaseRouting,
  validateCoupon,
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
type Acquisition = Readonly<{
  reads: ObservationReads;
  invoiceContext: InvoiceContextV1 | null;
}>;
type TransportCell = Readonly<{
  profile: FreshObservationProfile;
  invoiceProfile: InvoiceObservationProfile | null;
  guard(): void;
  consume(): Acquisition;
}>;
const actualTransports = new WeakMap<object, TransportCell | null>();
/** Only the original factory registers this guard after actual SDK selection. */
export function readFreshObservationTransport(
  token: object,
  profile: FreshObservationProfile,
  invoiceProfile: InvoiceObservationProfile | null,
) {
  const cell = actualTransports.get(token);
  freshNeed(
    cell && cell.profile === profile && cell.invoiceProfile === invoiceProfile,
  );
  cell.guard();
  return cell;
}
/** Returned DATA cannot register or replenish this once-consumed acquisition. */
export function consumeFreshObservationAcquisition(
  token: object,
  profile: FreshObservationProfile,
  invoiceProfile: InvoiceObservationProfile | null,
) {
  return readFreshObservationTransport(
    token,
    profile,
    invoiceProfile,
  ).consume();
}
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
  invoiceProfile: InvoiceObservationProfile | null = null,
) {
  freshNeed(arguments.length === 2 || arguments.length === 3);
  const state = readObservationInvocation(token),
    captured = state.readCaptured();
  freshNeed(!actualTransports.has(token));
  // Reserve before any Source callback or SDK selection; failed setup stays unavailable.
  actualTransports.set(token, null);
  freshNeed(state.historyEntry === profile.historyEntry);
  const covers = profile.coversObservation;
  const invoiceAddress =
    invoiceProfile &&
    JSON.stringify(getFunctionAddress(invoiceProfile.authorizationQuery));
  let invoiceAuthorization: ReturnType<
    typeof createInvoiceAuthorization
  > | null = null;
  let invoiceUsed = false;
  let completeInvoiceContext: InvoiceContextV1 | null = null;
  function profileGuard() {
    if (invoiceProfile) {
      invoiceProfileGuard(invoiceProfile);
      freshNeed(
        invoiceProfile.freshProfile === profile &&
          JSON.stringify(
            getFunctionAddress(invoiceProfile.authorizationQuery),
          ) === invoiceAddress,
      );
    }
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
    invoiceAuthorization?.guard();
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
  let acquisitionConsumed = false;
  actualTransports.set(
    token,
    Object.freeze({
      profile,
      invoiceProfile,
      guard,
      consume() {
        guard();
        freshNeed(
          !acquisitionConsumed &&
            !busy &&
            !ended &&
            ordinal >= 4 &&
            bodies.length === ordinal,
        );
        const reads: ObservationReads = {
          schedule: bodies[0],
          subscription: bodies[1],
          targetPrice: bodies[2],
          billingCustomer: bodies[3],
          coupons: bodies.slice(4),
        };
        validateBaseRouting(captured.history.record, reads);
        const ids = observationCouponIds(
          captured.history.record,
          reads.subscription,
        );
        freshNeed(ordinal === 4 + ids.length);
        ids.forEach((id, index) =>
          validateCoupon(captured.history.record, id, reads.coupons[index]),
        );
        freshNeed(
          invoiceProfile === null
            ? !invoiceUsed
            : completeInvoiceContext !== null,
        );
        const acquired = captureReaderQueryDATA({
          reads,
          invoiceContext: completeInvoiceContext,
        });
        acquisitionConsumed = true;
        guard();
        return acquired;
      },
    }),
  );
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
  async function dispatch(row: ObservationReadRow, invoiceRead = false) {
    if (invoiceRead) await invoiceAuthorization!.authorize();
    else await state.authorizeUnchanged();
    guard();

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
    return Object.freeze({ kind: "fulfilled" as const, body });
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
        freshNeed(!invoiceUsed && ordinal < 44 && !types.isProxy(raw));
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
        const result = await dispatch(row);
        ordinal++;
        if (result.kind === "provider_rejected") return result;
        const body = result.body;
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
    async finalizeInvoices() {
      if (invoiceAuthorization) await invoiceAuthorization.authorize();
      else await state.authorizeUnchanged();
      guard();
    },
    async acquireInvoices(): Promise<
      Readonly<{
        status: "complete" | "unavailable" | "conflict" | "provider_rejected";
        context: InvoiceContextV1 | null;
        reason: string | null;
        failure: ReadFailure | null;
      }>
    > {
      freshNeed(
        arguments.length === 0 &&
          invoiceProfile &&
          !invoiceUsed &&
          !busy &&
          !ended,
      );
      invoiceUsed = true;
      busy = true;
      try {
        guard();
        const reads: ObservationReads = {
          schedule: bodies[0],
          subscription: bodies[1],
          targetPrice: bodies[2],
          billingCustomer: bodies[3],
          coupons: bodies.slice(4),
        };
        validateBaseRouting(captured.history.record, reads);
        const ids = observationCouponIds(
          captured.history.record,
          reads.subscription,
        );
        freshNeed(ordinal === 4 + ids.length);
        reads.coupons.forEach((body, index) =>
          validateCoupon(captured.history.record, ids[index], body),
        );
        let plan: ReturnType<typeof createInvoiceReadPlan>;
        try {
          plan = createInvoiceReadPlan(captured.history.record, reads, ordinal);
        } catch (error) {
          if (!(error instanceof InvoiceAcquisitionStop)) throw error;
          return Object.freeze({
            status: error.kind,
            context: null,
            reason: error.reason,
            failure: null,
          });
        }
        invoiceAuthorization = createInvoiceAuthorization(
          token,
          invoiceProfile,
          plan.pins,
        );
        while (!plan.done()) {
          const result = await dispatch(plan.row(), true);
          if (result.kind === "provider_rejected")
            return Object.freeze({
              status: "provider_rejected",
              context: null,
              reason: null,
              failure: result.failure,
            });
          try {
            plan.accept(result.body);
          } catch (error) {
            if (!(error instanceof InvoiceAcquisitionStop)) throw error;
            return Object.freeze({
              status: error.kind,
              context: null,
              reason: error.reason,
              failure: null,
            });
          }
        }
        completeInvoiceContext = plan.context();
        return Object.freeze({
          status: "complete",
          context: completeInvoiceContext,
          reason: null,
          failure: null,
        });
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
