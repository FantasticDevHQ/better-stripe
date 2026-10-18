import { expect, it } from "vitest";
import { formatAmount } from "./format-amount";

it("preserves Stripe currency units for example balances and cost summaries", () => {
  expect(formatAmount(2500, "jpy")).toBe("¥2,500");
  expect(formatAmount(2500, "usd")).toBe("$25.00");
  expect(formatAmount(-101, "isk")).toBe("-ISK\u00a01.01");
});
