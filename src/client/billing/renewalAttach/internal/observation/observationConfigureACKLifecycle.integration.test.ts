import assert from "node:assert/strict";
import { it } from "vitest";
import { configureACKLifecycleCases } from "../test-fixtures/observationConfigureACKLifecycleDeclarations.js";
import { configureACKLifecycleFixture } from "../test-fixtures/observationConfigureACKLifecycleOperation.js";
import { assertConfigureACKLifecycleResult } from "../test-fixtures/observationConfigureACKLifecycleAssertions.js";

for (const controlCase of configureACKLifecycleCases)
  it("owned observation configure ACK lifecycle: " + controlCase, async () => {
    const h = await configureACKLifecycleFixture(controlCase);
    try {
      const original = h.capture().invoke();
      const expectedFailure = controlCase === "L07-C6Failure-priority";
      const value = expectedFailure
        ? await original
        : await original.then(
            () => assert.fail("EXPECTED_LIFECYCLE_REFUSAL"),
            (error: unknown) => error,
          );
      assertConfigureACKLifecycleResult(h, value);
      if (controlCase === "L04-POST-pending") await h.finishPendingWriter();
    } catch (originalError) {
      try {
        console.log(
          JSON.stringify({
            kind: "OPTIONAL_ACK_LIFECYCLE_FAILURE_FRONTIER",
            controlCase,
            counters: { ...h.counters },
            observationHTTP: h.calls.length,
            writerRecords: h.writer.writeState.records.length,
            writerPOSTs: h.writer.writeState.calls.filter(
              (row) => row.method === "POST",
            ).length,
            writerC9: h.writer.writeState.explicitC9,
            candidateKind: h.declaration.candidateKind,
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
