import { expect, it, vi } from "vitest";
import * as observation from "./settlementObservation";
it("retains a sanitized unknown outcome when recipient settlement cannot complete", async () => {
  const execute = vi.fn(async () => {
    throw new Error("private provider message sk_test_never_expose");
  });
  expect(await observation.observeDemoSettlement(execute)).toEqual({
    status: "unknown",
    reason: "provider_outcome_unknown",
    retryable: false,
  });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("preserves actual verified settlement output", async () => {
  const result = { status: "settled", executedTransfers: [{ amount: 100 }] };
  expect(await observation.observeDemoSettlement(async () => result)).toBe(
    result,
  );
});
