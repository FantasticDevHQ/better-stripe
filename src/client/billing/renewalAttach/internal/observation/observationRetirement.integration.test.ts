import { it } from "vitest";
import assert from "node:assert/strict";
import { observationFixture } from "../test-fixtures/observationOperation.js";
import { transportControlCases } from "../test-fixtures/observationDeclarations.js";
import {
  observationOutcome,
  assertPrivateObservationError,
  assertObservationReadPrefix,
  assertObservationProviderFailure,
} from "../test-fixtures/observationAssertions.js";
import {
  retireObservationHeld,
  logObservationFailureFrontier,
} from "../test-fixtures/observationProbe.js";

for (const mode of transportControlCases)
  it("repository observation transport control " + mode, async () => {
    const h = await observationFixture(mode);
    try {
      const original = h.capture().invoke();
      const outcome = h.declaration.transport.held
        ? await retireObservationHeld(h, original)
        : await observationOutcome(original);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        if (h.declaration.expectedOwner === "retired")
          assertPrivateObservationError(outcome.error, "ORIGINAL_OWNER_STOP");
        else assertObservationProviderFailure(h, outcome.error);
      }
      assert.equal(h.state.targetCalls, 1);
      assertObservationReadPrefix(h, h.declaration.transport.ordinal);
      assert.equal(
        h.http.traps(),
        0,
        "named late reply sentinel not reflected by owned continuation",
      );
      assert.equal(
        h.http.diagnosticGetterCalls(),
        0,
        "named late error/unsafe diagnostic getter never invoked",
      );
      if (h.declaration.transport.reject) {
        assert(h.http.actualError() instanceof Error);
        assert.equal(h.http.actualError(), h.http.transformedError());
        assert.equal(h.http.errorConfigurationVerified(), 1);
      } else {
        assert.equal(h.http.actualError(), null);
        assert.equal(h.http.errorConfigurationVerified(), 0);
      }
    } catch (originalError) {
      try {
        await logObservationFailureFrontier(h);
      } finally {
        throw originalError;
      }
    } finally {
      h.http.hold.release.resolve();
      await h.cleanup();
    }
  });
