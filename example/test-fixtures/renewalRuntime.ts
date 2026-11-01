import {
  prepareWitnessObservation,
  witnessControls,
} from "../../src/client/billing/renewalAttach/internal/test-fixtures/witnessObservation.js";
import { admissionControls } from "../../src/client/billing/renewalAttach/internal/test-fixtures/producerConfigureAdmission.js";
import { observerIdentity } from "../../src/client/billing/renewalAttach/internal/test-fixtures/observationReader.js";
import { observe, invoices, retain, read } from "./renewalAuthorization";
import assert from "node:assert/strict";

/** Test-only binding to the actual existing example queries, never production activation. */
export async function prepareExampleRenewal(
  h: Parameters<typeof prepareWitnessObservation>[0],
  withC9: boolean,
) {
  const state = await prepareWitnessObservation(h, withC9, true);
  const entry = Object.freeze({ ...state.entry, authorizationQuery: observe });
  const profile = Object.freeze({ ...state.profile, historyEntry: entry });
  const selectedInvoices = state.captureProfile.invoiceProfile;
  assert(selectedInvoices);
  const invoiceProfile = Object.freeze({
    ...selectedInvoices,
    freshProfile: profile,
    authorizationQuery: invoices,
  });
  const captureProfile = Object.freeze({
    freshProfile: profile,
    invoiceProfile,
    authorizationQuery: retain,
  });
  const readProfile = Object.freeze({
    freshProfile: profile,
    invoiceProfile,
    authorizationQuery: read,
  });
  admissionControls.history.splice(0, admissionControls.history.length, entry);
  admissionControls.observation.splice(
    0,
    admissionControls.observation.length,
    profile,
  );
  admissionControls.invoices.splice(
    0,
    admissionControls.invoices.length,
    invoiceProfile,
  );
  witnessControls.captures.splice(
    0,
    witnessControls.captures.length,
    captureProfile,
  );
  witnessControls.readers.splice(
    0,
    witnessControls.readers.length,
    readProfile,
  );
  const permission = {
    authorizationId: "example-runtime-observation",
    authorizationRevision: 1,
    expiresAtMs: Date.now() + 60000,
    revoked: false,
  };
  let operationGrantId!: import("../convex/_generated/dataModel").Id<"renewalOperationGrants">;
  let witnessGrantId!: import("../convex/_generated/dataModel").Id<"renewalWitnessGrants">;
  await h.runHost(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Authenticated controlled renewal observer",
      email: "observer@example.invalid",
      role: "buyer",
      authTokenIdentifier: observerIdentity.tokenIdentifier,
    });
    operationGrantId = await ctx.db.insert("renewalOperationGrants", {
      userId,
      tokenIdentifier: observerIdentity.tokenIdentifier,
      componentScope: state.scope.identity.componentScope,
      parentOperationId: state.scope.identity.parentOperationId,
      operationId: state.scope.identity.operationId,
      providerScope: state.scope.providerScope,
      observation: permission,
      invoice: {
        ...permission,
        authorizationId: "example-runtime-invoices",
        originalInvoiceId: "in_original",
        currentInvoiceId: "in_current",
      },
    });
    witnessGrantId = await ctx.db.insert("renewalWitnessGrants", {
      userId,
      tokenIdentifier: observerIdentity.tokenIdentifier,
      componentScope: state.scope.identity.componentScope,
      witnessId: state.scope.identity.witnessId,
      scope: state.scope,
      retain: { ...permission, authorizationId: "example-runtime-retain" },
      read: null,
    });
  });
  return {
    ...state,
    entry,
    profile,
    invoiceProfile,
    captureProfile,
    readProfile,
    operationGrantId,
    witnessGrantId,
    permission,
  };
}
