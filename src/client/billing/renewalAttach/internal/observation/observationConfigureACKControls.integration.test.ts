import assert from "node:assert/strict";
import { it } from "vitest";
import { optionalConfigureACKControlCases } from "../test-fixtures/observationConfigureACKDeclarations.js";
import { optionalConfigureACKControlFixture } from "../test-fixtures/observationConfigureACKOperation.js";
import {
  assertOptionalConfigureACK18,
  assertOptionalConfigureACKRefusal,
} from "../test-fixtures/observationConfigureACKAssertions.js";

for (const controlCase of optionalConfigureACKControlCases)
  it("owned observation configure ACK control: " + controlCase, async () => {
    const h = await optionalConfigureACKControlFixture(controlCase);
    try {
      const original = h.capture().invoke();
      if (h.selected.stage === "positive")
        assertOptionalConfigureACK18(h, await original);
      else {
        const error = await original.then(
          () => assert.fail("EXPECTED_OPTIONAL_CONFIGURE_ACK_REFUSAL"),
          (error: unknown) => error,
        );
        assertOptionalConfigureACKRefusal(h, error);
      }
    } catch (originalError) {
      try {
        console.log(
          JSON.stringify({
            kind: "OPTIONAL_CONFIGURE_ACK_CONTROL_FAILURE_FRONTIER",
            controlCase,
            declaredStage: h.selected.stage,
            counters: { ...h.counters },
            observationHTTP: h.calls.length,
            originalReadPromises: h.promises.length,
            writerRecords: h.writer.writeState.records.length,
            writerPOSTs: h.writer.writeState.calls.filter(
              (row) => row.method === "POST",
            ).length,
            writerExplicitC9: h.writer.writeState.explicitC9,
            operationalAuthority: false,
          }),
        );
      } finally {
        throw originalError;
      }
    } finally {
      await h.cleanup();
    }
  });
