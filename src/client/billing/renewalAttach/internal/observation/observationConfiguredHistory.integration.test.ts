import assert from "node:assert/strict";
import { it } from "vitest";
import { configuredHistoryCases } from "../test-fixtures/observationConfiguredHistoryDeclarations.js";
import { configuredHistoryFixture } from "../test-fixtures/observationConfiguredHistoryOperation.js";
import { assertConfiguredHistoryResult } from "../test-fixtures/observationConfiguredHistoryAssertions.js";

for (const controlCase of configuredHistoryCases)
  it("configured history owned observation: " + controlCase, async () => {
    const h = await configuredHistoryFixture(controlCase);
    try {
      assertConfiguredHistoryResult(h, await h.capture().invoke());
    } catch (originalError) {
      try {
        console.log(
          JSON.stringify({
            kind: "CONFIGURED_HISTORY_FAILURE_FRONTIER",
            controlCase,
            counters: { ...h.counters },
            observationHTTP: h.calls.length,
            originalReadPromises: h.promises.length,
            writerRecords: h.writer.writeState.records.length,
            writerPOSTs: h.writer.writeState.calls.filter(
              (row) => row.method === "POST",
            ).length,
            writerC9: h.writer.writeState.explicitC9,
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
