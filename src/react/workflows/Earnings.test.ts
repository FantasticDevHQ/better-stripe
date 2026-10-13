import { expect, it } from "vitest";
import { earningsFromBalance } from "./Earnings.js";
it("keeps currencies separate and includes only completed payouts in recipient totals", () => {
  const result = earningsFromBalance(
    { available: 1200, pending: 300, currency: "usd" },
    [
      { amount: 500, status: "paid", currency: "usd" },
      { amount: 9000, status: "paid", currency: "eur" },
      { amount: 200, status: "pending", currency: "usd" },
    ],
  );
  expect(result).toEqual({
    gross: 2000,
    net: 2000,
    reversed: 0,
    paidOut: 500,
    currency: "usd",
  });
});
