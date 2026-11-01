import { getFunctionAddress } from "convex/server";
import { types } from "node:util";
import { closed } from "../c10/ownData.js";
import {
  witnessIdentity,
  witnessText,
} from "../../../../../shared/renewalWitness.js";
import {
  captureWitnessProfile,
  witnessProfileGuard,
  witnessAddress,
  type WitnessMode,
  type WitnessProfile,
} from "./witnessAuthorization.js";
import { createWitnessOperation } from "./witnessOperation.js";
import {
  captureInvoiceObservationProfile,
  invoiceProfileGuard,
} from "./invoiceAuthorization.js";
import type { InvoiceObservationProfile } from "../operations/sourceOperations.js";
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
  return captureFreshObservation(root, raw, null);
}
/** Separate qualified invoice capability; EMPTY before any input reflection. */
export async function captureFreshInvoiceRenewalObservation(
  root: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  const profile = captureInvoiceObservationProfile(root);
  return captureFreshObservation(root, raw, profile);
}
type WitnessSpec = Readonly<{
  profile: WitnessProfile;
  mode: WitnessMode;
  identity: ReturnType<typeof witnessIdentity>;
}>;
export async function captureFreshWitnessRenewalObservation(
  root: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  return captureWitnessObservation(root, raw, "retain");
}
export async function captureHistoricalWitnessRenewalObservation(
  root: object,
  raw: unknown,
) {
  need(arguments.length === 2);
  return captureWitnessObservation(root, raw, "read");
}
function captureWitnessObservation(
  root: object,
  raw: unknown,
  mode: WitnessMode,
) {
  const profile = captureWitnessProfile(root, mode);
  need(!types.isProxy(raw));
  const input = closed(raw, [
    "actualActionCtx",
    "parentOperationId",
    "operationId",
    "witnessId",
  ]);
  const identity = witnessIdentity({
    componentScope: profile.freshProfile.historyEntry.componentScope,
    witnessId: witnessText(input.witnessId),
    parentOperationId: input.parentOperationId,
    operationId: input.operationId,
  });
  return captureFreshObservation(
    root,
    {
      actualActionCtx: input.actualActionCtx,
      parentOperationId: identity.parentOperationId,
      operationId: identity.operationId,
    },
    profile.invoiceProfile,
    { profile, mode, identity },
  );
}
async function captureFreshObservation(
  root: object,
  raw: unknown,
  invoiceProfile: InvoiceObservationProfile | null,
  witnessSpec: WitnessSpec | null = null,
) {
  const profile = captureFreshObservationProfile(root);
  const witnessQueryAddress =
    witnessSpec && witnessAddress(witnessSpec.profile.authorizationQuery);
  const invoiceAddress =
    invoiceProfile &&
    JSON.stringify(getFunctionAddress(invoiceProfile.authorizationQuery));
  const invoiceGuard = () => {
    if (witnessSpec) {
      witnessProfileGuard(witnessSpec.profile, witnessSpec.mode);
      need(
        witnessSpec.profile.freshProfile === profile &&
          witnessSpec.profile.invoiceProfile === invoiceProfile &&
          witnessAddress(witnessSpec.profile.authorizationQuery) ===
            witnessQueryAddress,
      );
    }
    if (invoiceProfile) {
      invoiceProfileGuard(invoiceProfile);
      need(
        invoiceProfile.freshProfile === profile &&
          JSON.stringify(
            getFunctionAddress(invoiceProfile.authorizationQuery),
          ) === invoiceAddress,
      );
    }
  };
  invoiceGuard();
  const token = await captureObservationInvocation(root, raw);
  let state: ObservationInvocationState;
  try {
    invoiceGuard();
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
        invoiceGuard();
        const captured = await state.captureHistory();
        invoiceGuard();
        const transport = captureFreshGetTransport(
          token,
          profile,
          invoiceProfile,
        );
        const witness =
          witnessSpec &&
          createWitnessOperation(
            token,
            witnessSpec.profile,
            witnessSpec.mode,
            witnessSpec.identity,
          );
        if (witnessSpec?.mode === "read") await witness!.load();
        let invoiceResult: Awaited<
          ReturnType<typeof transport.acquireInvoices>
        > | null = null;
        async function analyze(reads: ObservationReads | null) {
          return state.owned(async () => {
            try {
              const evidence = await inspectRenewalEvidenceV1({
                version: 1,
                apiVersion: "2026-09-30.endive",
                configuration: captured.history.record.configuration,
                configureReceipt: captured.history.rawConfigureReceipt,
                reads,
                invoiceContext: invoiceResult?.context ?? null,
                historicalSnapshot: null,
              });
              if (witnessSpec?.mode !== "read") return evidence;
              const historical = await witness!.historicalEvidence();
              return {
                ...evidence,
                identity: evidence.identity ?? historical.identity,
                historicalMaterial: historical.material,
              };
            } catch {
              return null;
            }
          }, transport.guard);
        }
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
          await transport.finalizeInvoices();
          transport.guard();
          let witnessRetention: Awaited<
            ReturnType<ReturnType<typeof createWitnessOperation>["retain"]>
          > | null = null;
          if (witnessSpec?.mode === "retain") {
            need(
              status === "fresh_observation_data" &&
                reads &&
                evidence?.currentMaterial.predicate ===
                  "current_target_material_match" &&
                couponInventory === "complete",
            );
            if (invoiceProfile)
              need(
                invoiceResult?.status === "complete" && invoiceResult.context,
              );
            witnessRetention = await witness!.retain();
            await transport.finalizeInvoices();
          } else if (witnessSpec?.mode === "read" && evidence === null)
            evidence = await analyze(reads);
          if (witness) await witness.finalize();
          const output = captureReaderQueryDATA({
            status,
            ...(witnessSpec?.mode === "retain"
              ? { witnessRetention }
              : witnessSpec?.mode === "read"
                ? { witness: { descriptor: witness!.descriptor() } }
                : {}),
            ...(invoiceProfile
              ? {
                  invoiceContext: invoiceResult?.context ?? null,
                  invoiceInventory: invoiceResult?.status ?? "not_acquired",
                  invoiceReason: invoiceResult?.reason ?? null,
                }
              : {}),
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
          witness?.guard();
          return output;
        }
        const base: unknown[] = [];
        for (const row of baseReadRows(captured.history.record)) {
          witness?.guard();
          const result = await transport.read(row);
          witness?.guard();
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
        let ids: readonly string[];
        try {
          validateBaseRouting(captured.history.record, reads);
          ids = observationCouponIds(
            captured.history.record,
            reads.subscription,
          );
        } catch {
          const analysis = await analyze(reads);
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
          witness?.guard();
          const result = await transport.read(row);
          witness?.guard();
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
        if (invoiceProfile) {
          witness?.guard();
          invoiceResult = await transport.acquireInvoices();
          witness?.guard();
          if (invoiceResult.status === "provider_rejected")
            return await release(
              "observation_provider_rejected",
              null,
              null,
              "complete",
              null,
              invoiceResult.failure,
            );
        }
        const evidence = await analyze(reads);
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
