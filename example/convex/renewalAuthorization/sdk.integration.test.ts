import assert from "node:assert/strict";
import { expect } from "vitest";
import { configureAdmissionCase } from "../../../src/client/billing/renewalAttach/internal/test-fixtures/producerConfigureAdmission.js";
import {
  invokeWitnessCapture,
  invokeWitnessRead,
  readStoredWitness,
  witnessFixtureOptions,
} from "../../../src/client/billing/renewalAttach/internal/test-fixtures/witnessObservation.js";
import { prepareExampleRenewal } from "../../test-fixtures/renewalRuntime";
import { getFunctionAddress } from "convex/server";

for (const withC9 of [false, true])
  configureAdmissionCase(
    "uses the existing example's real host queries for SDK capture and historical read with C9 " +
      withC9,
    (h) => prepareExampleRenewal(h, withC9),
    async (h, state) => {
      const first = await invokeWitnessCapture(h, state);
      assert(
        "witnessRetention" in first &&
          first.witnessRetention?.status === "retained",
      );
      expect(first.evidence?.currentMaterial.predicate).toBe(
        "current_target_material_match",
      );
      expect(first.evidence?.invoiceEvidence.predicate).toBe(
        "invoice_lines_correlated",
      );
      const descriptor = first.witnessRetention.descriptor;
      await expect(invokeWitnessRead(h, state)).rejects.toThrow();
      await h.runHost((ctx) =>
        ctx.db.patch("renewalWitnessGrants", state.witnessGrantId, {
          read: {
            ...state.permission,
            authorizationId: "example-runtime-exact-read",
            witnessRowId: descriptor.witnessRowId,
            payloadBinding: descriptor.payloadBinding,
          },
        }),
      );
      const later = await invokeWitnessRead(h, state);
      expect(later.evidence?.historicalMaterial.predicate).toBe(
        "snapshot_target_material_match",
      );
      const stored = await readStoredWitness(h, state);
      assert(stored);
      expect(stored.descriptor).toEqual(descriptor);
      expect(
        JSON.parse(stored.payloadJSON).source.configure.acknowledgement ===
          null,
      ).toBe(!withC9);
    },
    witnessFixtureOptions,
  );

for (const change of ["revision", "scope"] as const)
  configureAdmissionCase(
    "SDK refuses " +
      change +
      " drift between actual example query authorizations",
    (h) => prepareExampleRenewal(h, false),
    async (h, state) => {
      let changed = false;
      await expect(
        invokeWitnessCapture(h, state, {
          before(ctx) {
            const original = ctx.runQuery;
            ctx.runQuery = async (ref, ...args) => {
              const reply = await original(ref, ...args);
              const address = getFunctionAddress(ref);
              if (
                !changed &&
                address.name === "renewalAuthorization/queries:observe"
              ) {
                changed = true;
                await h.runHost((dbCtx) =>
                  dbCtx.db.patch(
                    "renewalOperationGrants",
                    state.operationGrantId,
                    change === "revision"
                      ? {
                          observation: {
                            ...state.permission,
                            authorizationRevision: 2,
                          },
                        }
                      : {
                          providerScope: {
                            ...state.scope.providerScope,
                            customerAccountId: "acct_foreign",
                          },
                        },
                  ),
                );
              }
              return reply;
            };
          },
        }),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      expect(await readStoredWitness(h, state)).toBeNull();
    },
    witnessFixtureOptions,
  );
