/**
 * Tests for `clearAll`, the destructive dev/test reset helper. The only real
 * logic here is delegation: it must resolve the `core/mutations/clearAllTables`
 * component ref and run it through `runMutationOrThrow`, which itself refuses to
 * proceed without a `ctx.runMutation`. These tests pin the exact ref + args
 * passed to the boundary, the value returned, and the no-runMutation guard.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { clearAll } from "./data.js";

const TO_REF = Symbol.for("toReferencePath");

function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    core: {
      mutations: {
        clearAllTables: ref("core/mutations/clearAllTables"),
      },
    },
  } as unknown as Component;
}

describe("clearAll", () => {
  it("runs the core/mutations/clearAllTables mutation with empty args and returns its result", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValue({ cleared: 7, tables: ["accounts", "products"] });
    const ctx = { runMutation } as unknown as RunCtx;

    const result = await clearAll(makeComponent(), ctx);

    expect(result).toEqual({ cleared: 7, tables: ["accounts", "products"] });
    expect(runMutation).toHaveBeenCalledTimes(1);
    // exact ref resolved + empty args object
    expect(runMutation.mock.calls[0][0]).toEqual({
      [TO_REF]: "betterStripe/core/mutations/clearAllTables",
    });
    expect(runMutation.mock.calls[0][1]).toEqual({});
  });

  it("throws the runMutationOrThrow guard error when ctx has no runMutation", async () => {
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;

    await expect(clearAll(makeComponent(), ctx)).rejects.toThrow(
      "This BetterStripe method requires a Convex ctx with runMutation.",
    );
  });

  it("propagates an error thrown by the underlying mutation", async () => {
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(new Error("table locked")),
    } as unknown as RunCtx;

    await expect(clearAll(makeComponent(), ctx)).rejects.toThrow("table locked");
  });
});
