import { types } from "node:util";
import { getFunctionAddress } from "convex/server";
import {
  COMPILED_WITNESS_CAPTURE_ENTRIES,
  COMPILED_WITNESS_READ_ENTRIES,
  type WitnessCaptureProfile,
  type WitnessReadProfile,
  type WitnessScope,
} from "../operations/witnessProfiles.js";
import {
  COMPILED_FRESH_OBSERVATION_ENTRIES,
  COMPILED_OBSERVATION_HISTORY_ENTRIES,
} from "../operations/sourceOperations.js";
import {
  readMaintainedRootComponent,
  readCheckedJournalActionRPC,
} from "../producer/classOwnedActionRoot.js";
import { invoiceProfileGuard } from "./invoiceAuthorization.js";
import { closed, freeze } from "../c10/ownData.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import {
  captureReaderQueryDATA,
  readerText as text,
} from "./readerAuthorization.js";
import type { ObservationInvocationState } from "./invocation.js";
import {
  witnessIdentity,
  witnessNeed as need,
  type WitnessIdentity,
} from "../../../../../shared/renewalWitness.js";

export type WitnessMode = "retain" | "read";
export type WitnessProfile = WitnessCaptureProfile | WitnessReadProfile;
const nativeThen = Promise.prototype.then;
export const witnessAddress = (ref: Parameters<typeof getFunctionAddress>[0]) =>
  JSON.stringify(getFunctionAddress(ref));
export function witnessProfileGuard(
  profile: WitnessProfile,
  mode: WitnessMode,
) {
  const entries: readonly WitnessProfile[] =
    mode === "retain"
      ? COMPILED_WITNESS_CAPTURE_ENTRIES
      : COMPILED_WITNESS_READ_ENTRIES;
  need(!types.isProxy(profile));
  closed(profile, ["freshProfile", "invoiceProfile", "authorizationQuery"]);
  need(Object.isFrozen(profile) && entries.includes(profile));
  const fresh = profile.freshProfile;
  need(
    COMPILED_FRESH_OBSERVATION_ENTRIES.includes(fresh) &&
      COMPILED_OBSERVATION_HISTORY_ENTRIES.includes(fresh.historyEntry),
  );
  need(
    entries.filter(
      (entry) =>
        entry.freshProfile.historyEntry.component ===
        fresh.historyEntry.component,
    ).length === 1,
  );
  if (profile.invoiceProfile !== null) {
    invoiceProfileGuard(profile.invoiceProfile);
    need(profile.invoiceProfile.freshProfile === fresh);
  }
}
/** The EMPTY check precedes root/input reflection, clocks and SDK selection. */
export function captureWitnessProfile(
  root: object,
  mode: WitnessMode,
): WitnessProfile {
  const entries: readonly WitnessProfile[] =
    mode === "retain"
      ? COMPILED_WITNESS_CAPTURE_ENTRIES
      : COMPILED_WITNESS_READ_ENTRIES;
  if (entries.length === 0) throw Error("RENEWAL_WITNESS_UNBOUND");
  const component = readMaintainedRootComponent(root);
  const matches = entries.filter((profile) => {
    need(!types.isProxy(profile));
    closed(profile, ["freshProfile", "invoiceProfile", "authorizationQuery"]);
    return profile.freshProfile.historyEntry.component === component;
  });
  need(matches.length === 1);
  witnessProfileGuard(matches[0], mode);
  return matches[0];
}
/** Brand and settle the original RPC Promise without adopting a public .then substitute. */
export function witnessRPC<T>(
  state: ObservationInvocationState,
  work: () => Promise<T>,
  guard: () => void,
): Promise<T> {
  return state.owned(() => {
    const pending = work();
    need(types.isPromise(pending));
    return new Promise<T>((resolve, reject) => {
      Reflect.apply(nativeThen, pending, [resolve, reject]);
    });
  }, guard);
}
function checkedScope(raw: unknown): WitnessScope {
  const scope = closed(raw, [
    "identity",
    "providerScope",
    "configureRequestBinding",
    "observedItemId",
    "nativePeriod",
  ]);
  const provider = closed(scope.providerScope, [
    "mode",
    "stripeAccount",
    "livemode",
    "customerAccountId",
    "customerId",
    "subscriptionId",
    "scheduleId",
  ]);
  need(
    provider.mode === "platform" &&
      provider.stripeAccount === null &&
      typeof provider.livemode === "boolean",
  );
  const period = closed(scope.nativePeriod, ["start", "end"]);
  need(
    typeof period.start === "number" &&
      Number.isSafeInteger(period.start) &&
      period.start >= 0 &&
      typeof period.end === "number" &&
      Number.isSafeInteger(period.end) &&
      period.end > period.start,
  );
  return freeze({
    identity: witnessIdentity(scope.identity),
    providerScope: {
      mode: "platform",
      stripeAccount: null,
      livemode: provider.livemode,
      customerAccountId: text(provider.customerAccountId),
      customerId: text(provider.customerId),
      subscriptionId: text(provider.subscriptionId),
      scheduleId: text(provider.scheduleId),
    },
    configureRequestBinding: text(scope.configureRequestBinding),
    observedItemId: text(scope.observedItemId),
    nativePeriod: { start: period.start, end: period.end },
  });
}
export function createWitnessAuthorization(
  state: ObservationInvocationState,
  profile: WitnessProfile,
  mode: WitnessMode,
  identity: WitnessIdentity,
  expectedScope: WitnessScope | null,
) {
  const rpc = readCheckedJournalActionRPC(state.binding),
    query = profile.authorizationQuery;
  const address = witnessAddress(query),
    base = state.readCaptured().authorization;
  const args =
    mode === "retain"
      ? {
          capability: "renewal_witness_retain_v1" as const,
          scope: expectedScope!,
        }
      : { capability: "renewal_witness_read_v1" as const, identity };
  need(mode !== "retain" || expectedScope);
  let grant: Record<string, unknown> | null = null;
  let expiry: number | null = null;
  function guard() {
    state.guard();
    witnessProfileGuard(profile, mode);
    need(
      profile.authorizationQuery === query &&
        witnessAddress(query) === address &&
        profile.freshProfile.historyEntry === state.historyEntry &&
        readCheckedJournalActionRPC(state.binding) === rpc,
    );
    if (expiry !== null) need(state.check().wallMs < expiry);
  }
  return Object.freeze({
    guard,
    async authorize() {
      guard();
      await state.authorizeUnchanged();
      guard();
      const raw: unknown = await witnessRPC(
        state,
        () => rpc.runQuery.call(rpc.receiver, query, args),
        guard,
      );
      const reply = captureReaderQueryDATA(raw);
      need(new TextEncoder().encode(JSON.stringify(reply)).length <= 8192);
      const data = closed(reply, [
        "capability",
        "scope",
        "tokenIdentifier",
        "authorizationId",
        "authorizationRevision",
        "expiresAtMs",
        ...(mode === "read" ? ["witnessRowId", "payloadBinding"] : []),
      ]);
      const scope = checkedScope(data.scope);
      need(
        data.capability === args.capability &&
          data.tokenIdentifier === base.tokenIdentifier,
      );
      matchConfigureDATA(scope.identity, identity);
      if (expectedScope) matchConfigureDATA(scope, expectedScope);
      text(data.authorizationId);
      need(
        typeof data.authorizationRevision === "number" &&
          Number.isSafeInteger(data.authorizationRevision) &&
          data.authorizationRevision > 0,
      );
      need(
        typeof data.expiresAtMs === "number" &&
          Number.isSafeInteger(data.expiresAtMs) &&
          data.expiresAtMs > state.check().wallMs,
      );
      if (mode === "read") {
        text(data.witnessRowId);
        need(
          /^renewal-witness:v1:sha256:[0-9a-f]{64}$/.test(
            text(data.payloadBinding),
          ),
        );
      }
      if (grant) matchConfigureDATA(data, grant);
      else {
        grant = freeze(data);
        expiry = data.expiresAtMs;
      }
      guard();
      return freeze({
        scope,
        witnessRowId: mode === "read" ? text(data.witnessRowId) : null,
        payloadBinding: mode === "read" ? text(data.payloadBinding) : null,
      });
    },
  });
}
