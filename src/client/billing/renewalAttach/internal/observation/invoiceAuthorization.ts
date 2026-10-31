import { types } from "node:util";
import { getFunctionAddress } from "convex/server";
import {
  COMPILED_INVOICE_OBSERVATION_ENTRIES,
  COMPILED_FRESH_OBSERVATION_ENTRIES,
  type InvoiceObservationProfile,
  type InvoiceAuthorizationArgs,
} from "../operations/sourceOperations.js";
import {
  readMaintainedRootComponent,
  readCheckedJournalActionRPC,
} from "../producer/classOwnedActionRoot.js";
import { readObservationInvocation } from "./invocation.js";
import { closed, freeze } from "../c10/ownData.js";
import {
  captureReaderQueryDATA,
  readerNeed as need,
  readerText as text,
} from "./readerAuthorization.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import type { createInvoiceReadPlan } from "./invoicePlan.js";

export function invoiceProfileGuard(profile: InvoiceObservationProfile) {
  need(!types.isProxy(profile));
  closed(profile, ["freshProfile", "readProfile", "authorizationQuery"]);
  need(
    Object.isFrozen(profile) &&
      profile.readProfile === "endive-pinned-invoices-fence-7-v1" &&
      COMPILED_INVOICE_OBSERVATION_ENTRIES.includes(profile),
  );
  need(
    COMPILED_INVOICE_OBSERVATION_ENTRIES.filter(
      (p) => p.freshProfile === profile.freshProfile,
    ).length === 1 &&
      COMPILED_FRESH_OBSERVATION_ENTRIES.includes(profile.freshProfile),
  );
  // Maintained Convex api/internal references are proxies. The fixed Source
  // association and captured semantic address bind this reference instead.
}
export function captureInvoiceObservationProfile(root: object) {
  if (COMPILED_INVOICE_OBSERVATION_ENTRIES.length === 0)
    throw Error("INVOICE_OBSERVATION_UNBOUND");
  const component = readMaintainedRootComponent(root);
  const entries = COMPILED_INVOICE_OBSERVATION_ENTRIES.filter((p) => {
    need(!types.isProxy(p));
    closed(p, ["freshProfile", "readProfile", "authorizationQuery"]);
    return p.freshProfile.historyEntry.component === component;
  });
  need(entries.length === 1);
  invoiceProfileGuard(entries[0]);
  return entries[0];
}
/** Independent fixed invoice capability. No caller-supplied reference or grant. */
export function createInvoiceAuthorization(
  token: object,
  profile: InvoiceObservationProfile,
  pins: ReturnType<typeof createInvoiceReadPlan>["pins"],
) {
  const state = readObservationInvocation(token),
    captured = state.readCaptured();
  need(profile.freshProfile.historyEntry === state.historyEntry);
  const query = profile.authorizationQuery;
  const address = JSON.stringify(getFunctionAddress(query));
  const rpc = readCheckedJournalActionRPC(state.binding);
  const base = captured.authorization;
  const args: InvoiceAuthorizationArgs = freeze({
    capability: "renewal_invoice_evidence_v1",
    componentScope: base.componentScope,
    parentOperationId: base.parentOperationId,
    operationId: base.operationId,
    providerScope: { ...base.providerScope, customerId: pins.customerId },
    originalInvoiceId: pins.originalInvoiceId,
    currentInvoiceId: pins.currentInvoiceId,
  });
  let grant: ReturnType<
    typeof captureReaderQueryDATA<Record<string, unknown>>
  > | null = null;
  let expiresAt: number | null = null;
  function guard() {
    state.guard();
    invoiceProfileGuard(profile);
    need(
      profile.authorizationQuery === query &&
        JSON.stringify(getFunctionAddress(query)) === address,
    );
    need(readCheckedJournalActionRPC(state.binding) === rpc);
    if (expiresAt !== null) need(state.check().wallMs < expiresAt);
  }
  return Object.freeze({
    guard,
    async authorize() {
      guard();
      await state.authorizeUnchanged();
      guard();
      const raw: unknown = await state.owned(
        () => rpc.runQuery.call(rpc.receiver, query, args),
        guard,
      );
      const reply = captureReaderQueryDATA(raw);
      const data = closed(reply, [
        "capability",
        "componentScope",
        "parentOperationId",
        "operationId",
        "providerScope",
        "originalInvoiceId",
        "currentInvoiceId",
        "tokenIdentifier",
        "authorizationId",
        "authorizationRevision",
        "expiresAtMs",
      ]);
      matchConfigureDATA(
        {
          capability: data.capability,
          componentScope: data.componentScope,
          parentOperationId: data.parentOperationId,
          operationId: data.operationId,
          providerScope: data.providerScope,
          originalInvoiceId: data.originalInvoiceId,
          currentInvoiceId: data.currentInvoiceId,
        },
        args,
      );
      need(data.tokenIdentifier === base.tokenIdentifier);
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
      if (grant) matchConfigureDATA(reply, grant);
      else {
        grant = data;
        expiresAt = data.expiresAtMs;
      }
      guard();
    },
  });
}
