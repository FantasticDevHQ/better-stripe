import {
  captureObservationInvocation,
  readObservationInvocation,
  closeObservationInvocation,
  type ObservationInvocationState,
} from "./invocation.js";
import {
  captureFreshObservationProfile,
  captureFreshGetTransport,
  freshNeed as need,
} from "./freshTransport.js";
import {
  baseReadRows,
  validateObservationIdentityRouting,
  validateBaseRouting,
  observationCouponIds,
  couponReadRow,
  validateCoupon,
} from "./profile.js";
import { inspectRenewalEvidenceV1 } from "../../../renewalObservation/evidence-v1.js";
import { captureReaderQueryDATA } from "./readerAuthorization.js";
import type { RenewalEvidenceResultV1 } from "../../../renewalObservation/evidence-v1-types.js";
import type { ObservationReads, ReadFailure } from "./types.js";

/** Fresh authorized bounded current evidence. No caller DATA can create an invocation. */
export async function captureFreshRenewalObservation(
  root: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  const profile = captureFreshObservationProfile(root);
  const token = await captureObservationInvocation(root, raw);
  let state: ObservationInvocationState;
  try {
    state = readObservationInvocation(token);
    need(state.historyEntry === profile.historyEntry);
  } catch (error) {
    closeObservationInvocation(token);
    throw error;
  }
  let used = false;
  return Object.freeze({
    async invoke() {
      need(arguments.length === 0 && !used);
      used = true;
      try {
        const captured = await state.captureHistory();
        const transport = captureFreshGetTransport(token, profile);
        async function release(
          status:
            | "fresh_observation_data"
            | "unsupported_observation_profile"
            | "observation_provider_rejected"
            | "observation_conflict",
          reads: ObservationReads | null,
          evidence: RenewalEvidenceResultV1 | null,
          couponInventory: "complete" | "incomplete" | "not_acquired",
          reason: string | null,
          failure: ReadFailure | null = null,
        ) {
          await state.authorizeUnchanged();
          transport.guard();
          const output = captureReaderQueryDATA({
            status,
            ...captured,
            reads,
            evidence,
            couponInventory,
            observedAt: Math.floor(state.check().wallMs / 1000),
            analysis:
              evidence === null
                ? ("analysis_not_admitted" as const)
                : ("admitted" as const),
            reason,
            failure,
            operationalAuthority: false as const,
          });
          transport.guard();
          return output;
        }
        const base: unknown[] = [];
        for (const row of baseReadRows(captured.history.record)) {
          const result = await transport.read(row);
          if (result.kind === "provider_rejected")
            return await release(
              "observation_provider_rejected",
              null,
              null,
              "not_acquired",
              null,
              result.failure,
            );
          base.push(result.body);
        }
        const reads: ObservationReads = {
          schedule: base[0],
          subscription: base[1],
          targetPrice: base[2],
          billingCustomer: base[3],
          coupons: [],
        };
        try {
          validateObservationIdentityRouting(captured.history.record, reads);
        } catch {
          return await release(
            "observation_conflict",
            null,
            null,
            "incomplete",
            "PROVIDER_IDENTITY_CONFLICT",
          );
        }
        async function analyze() {
          return state.owned(async () => {
            try {
              return await inspectRenewalEvidenceV1({
                version: 1,
                apiVersion: "2026-09-30.endive",
                configuration: captured.history.record.configuration,
                configureReceipt: captured.history.rawConfigureReceipt,
                reads,
                invoiceContext: null,
                historicalSnapshot: null,
              });
            } catch {
              return null;
            }
          }, transport.guard);
        }
        let ids: readonly string[];
        try {
          validateBaseRouting(captured.history.record, reads);
          ids = observationCouponIds(
            captured.history.record,
            reads.subscription,
          );
        } catch {
          const analysis = await analyze();
          return await release(
            "unsupported_observation_profile",
            reads,
            analysis,
            "incomplete",
            "COUPON_INVENTORY_UNSUPPORTED",
          );
        }
        for (const id of ids) {
          const row = couponReadRow(id, 5 + reads.coupons.length);
          const result = await transport.read(row);
          if (result.kind === "provider_rejected")
            return await release(
              "observation_provider_rejected",
              null,
              null,
              "incomplete",
              null,
              result.failure,
            );
          validateCoupon(captured.history.record, id, result.body);
          reads.coupons.push(result.body);
        }
        const evidence = await analyze();
        return await release(
          "fresh_observation_data",
          reads,
          evidence,
          "complete",
          null,
        );
      } finally {
        closeObservationInvocation(token);
      }
    },
  });
}
