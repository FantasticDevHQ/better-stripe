import { it } from "vitest";
import { optionalConfigureACK18Fixture } from "../test-fixtures/observationConfigureACKOperation.js";
import { assertOptionalConfigureACK18 } from "../test-fixtures/observationConfigureACKAssertions.js";

it("owned observation retains actual published configure ACK18 with historical unknown", async () => {
  const h = await optionalConfigureACK18Fixture();
  try {
    const output = await h.capture().invoke();
    assertOptionalConfigureACK18(h, output);
  } catch (originalError) {
    try {
      console.log(
        JSON.stringify({
          kind: "OPTIONAL_ACK18_TARGET_FAILURE_FRONTIER",
          counters: { ...h.counters },
          observationHTTP: h.calls.length,
          originalReadPromises: h.promises.length,
          writerRecords: h.writer.writeState.records.length,
          writerPOSTs: h.writer.writeState.calls.filter(
            (row) => row.method === "POST",
          ).length,
          writerExplicitC9: h.writer.writeState.explicitC9,
          setupRecords: h.writer.state.records.length,
          setupPOSTs: h.writer.state.calls.filter(
            (row) => row.method === "POST",
          ).length,
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
