import { it } from "vitest";
import type { ConfigureWriteFixture } from "../test-fixtures/configureWriteOperation.js";
import { assertConfigureACK } from "../test-fixtures/configureWriteAssertions.js";
import { writerFrontierDiagnostics } from "../test-fixtures/configureWriteObservations.js";
import { writeCases } from "../test-fixtures/configureWriteDeclarations.js";

for (const name of writeCases.dispatch)
  it(
    "bounded configure writer acknowledges complete raw response: " + name,
    async () => {
      const diagnostic = writerFrontierDiagnostics();
      let h: ConfigureWriteFixture | undefined;
      try {
        const { configureWriteFixture } =
          await import("../test-fixtures/configureWriteOperation.js");
        h = await configureWriteFixture(name);
        assertConfigureACK(h, await h.captureWriter().invoke());
      } catch (error) {
        try {
          diagnostic.log(h?.writeState, h?.state.readerBindings);
        } finally {
          throw error;
        }
      } finally {
        try {
          if (h) await h.cleanup();
        } finally {
          await diagnostic.cleanup();
        }
      }
    },
  );
