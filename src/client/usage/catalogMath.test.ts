import { expect, it } from "vitest";
import { scaledUsageRate } from "./catalogMath.js";
it("scales native per-unit rates exactly without money floats", () => {
  expect(scaledUsageRate("2", 2)).toBe("0.02");
  expect(scaledUsageRate("123.4500", 3)).toBe("0.12345");
  expect(scaledUsageRate("0", 6)).toBe("0");
  expect(scaledUsageRate("999999999999.123456", 6)).toBe("999999.999999123456");
});
it("rejects native decimal precision loss rather than rounding", () => {
  expect(() => scaledUsageRate("0.000000000001", 1)).toThrow();
  expect(() => scaledUsageRate("2", 7)).toThrow();
  expect(() => scaledUsageRate("-2", 0)).toThrow();
});
