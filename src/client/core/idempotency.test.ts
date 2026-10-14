import { expect, it } from "vitest";
import { idempotencyOptions } from "./idempotency.js";
it("preserves omitted options and validates explicit request identities", () => {
  expect(idempotencyOptions(undefined)).toBeUndefined();
  expect(idempotencyOptions("logical-order:123")).toEqual({
    idempotencyKey: "logical-order:123",
  });
  for (const key of ["", "  ", "bad\nkey", "x".repeat(256)])
    expect(() => idempotencyOptions(key)).toThrow();
});
