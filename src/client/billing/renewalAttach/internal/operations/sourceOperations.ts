import type { ObservationHistorySourceEntry } from "../observation/readerAuthorization.js";
import type { ObservationRecord } from "../observation/types.js";
import type { FunctionReference } from "convex/server";
export type FreshObservationProfile = Readonly<{
  historyEntry: ObservationHistorySourceEntry;
  readProfile: "endive-schedule-first-44-v1";
  coversObservation(record: ObservationRecord): boolean;
}>;
export type InvoiceAuthorizationArgs = {
  capability: "renewal_invoice_evidence_v1";
  componentScope: string;
  parentOperationId: string;
  operationId: string;
  providerScope: {
    mode: "platform";
    stripeAccount: null;
    livemode: boolean;
    customerAccountId: string;
    customerId: string;
    subscriptionId: string;
    scheduleId: string;
  };
  originalInvoiceId: string;
  currentInvoiceId: string;
};
export type InvoiceObservationProfile = Readonly<{
  freshProfile: FreshObservationProfile;
  readProfile: "endive-pinned-invoices-fence-7-v1";
  authorizationQuery: FunctionReference<
    "query",
    "public" | "internal",
    InvoiceAuthorizationArgs,
    unknown
  >;
}>;
export const COMPILED_INVOICE_OBSERVATION_ENTRIES: readonly InvoiceObservationProfile[] =
  Object.freeze([]);
/** Fixed internal operation associations. No production producer or class is bound. */
export const COMPILED_INITIAL_ENTRIES: readonly unknown[] = Object.freeze([]);
export const COMPILED_RECOVERY_ENTRIES: readonly unknown[] = Object.freeze([]);
export const COMPILED_PREFLIGHT_ENTRIES: readonly unknown[] = Object.freeze([]);
export const COMPILED_CONFIGURE_WRITE_ENTRIES: readonly unknown[] =
  Object.freeze([]);
export const ORIGINAL_ORIGIN_ASSOCIATION: object | null = null;
export function loadFixedInitialOperation(): unknown {
  throw Error("INITIAL_SOURCE_UNBOUND");
}
export function loadFixedExplicitRecoveryOperation(): unknown {
  throw Error("RECOVERY_SOURCE_UNBOUND");
}
export function loadOwnedTransportSource(): unknown {
  throw Error("OWNED_TRANSPORT_SOURCE_UNBOUND");
}
export function loadOwnedConfigureOperation(): unknown {
  throw Error("CONFIGURE_PREFLIGHT_SOURCE_UNBOUND");
}

export function loadInitialOwnedTransportSource(): unknown {
  throw Error("INITIAL_TRANSPORT_SOURCE_UNBOUND");
}
export function loadRecoveryOwnedTransportSource(): unknown {
  throw Error("RECOVERY_TRANSPORT_SOURCE_UNBOUND");
}

export function loadConfigureOwnedReadTransportSource(): unknown {
  throw Error("CONFIGURE_READ_TRANSPORT_SOURCE_UNBOUND");
}

export function loadFixedConfigureWriteOperation(): unknown {
  throw Error("CONFIGURE_WRITE_SOURCE_UNBOUND");
}
export function loadFixedConfigureReplayOperation(): unknown {
  throw Error("CONFIGURE_REPLAY_SOURCE_UNBOUND");
}
export function loadConfigureWriteTransportSource(): unknown {
  throw Error("CONFIGURE_WRITE_TRANSPORT_SOURCE_UNBOUND");
}
export function loadConfigureReplayTransportSource(): unknown {
  throw Error("CONFIGURE_REPLAY_TRANSPORT_SOURCE_UNBOUND");
}

export const COMPILED_OBSERVATION_ENTRIES: readonly unknown[] = Object.freeze(
  [],
);
export const COMPILED_OBSERVATION_HISTORY_ENTRIES: readonly ObservationHistorySourceEntry[] =
  Object.freeze([]);
export const COMPILED_FRESH_OBSERVATION_ENTRIES: readonly FreshObservationProfile[] =
  Object.freeze([]);
export function loadFixedObservationOperation(): unknown {
  throw Error("OBSERVATION_SOURCE_UNBOUND");
}
