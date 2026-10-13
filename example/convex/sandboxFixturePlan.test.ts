import { expect, it } from "vitest";
import {
  SANDBOX_SALES,
  SANDBOX_REFUNDS,
  SANDBOX_DISPUTES,
  fixtureKey,
} from "./lib/sandboxFixturePlan";
it("provides a useful spread of genuine sandbox scenarios across the seller personas", () => {
  expect(SANDBOX_SALES).toHaveLength(36);
  expect(new Set(SANDBOX_SALES.map((sale) => sale.sellerEmail)).size).toBe(2);
  expect(SANDBOX_SALES.filter((sale) => sale.referred).length).toBeGreaterThan(
    10,
  );
  expect(SANDBOX_REFUNDS.length).toBeGreaterThanOrEqual(5);
  expect(SANDBOX_DISPUTES.map((d) => d.outcome)).toEqual(
    expect.arrayContaining(["open", "won", "lost"]),
  );
  expect(
    SANDBOX_DISPUTES.every((d) =>
      d.paymentMethod.startsWith("pm_card_createDispute"),
    ),
  ).toBe(true);
});
it("uses repeatable, account-scoped fixture keys and only Stripe test methods", () => {
  expect(fixtureKey("acct_a", "sale:1")).toBe(fixtureKey("acct_a", "sale:1"));
  expect(fixtureKey("acct_a", "sale:1")).not.toBe(
    fixtureKey("acct_b", "sale:1"),
  );
  expect(new Set(SANDBOX_SALES.map((s) => s.key)).size).toBe(
    SANDBOX_SALES.length,
  );
  expect(
    SANDBOX_SALES.every(
      (s) => s.paymentMethod.startsWith("pm_card_") && s.amount >= 1000,
    ),
  ).toBe(true);
});
