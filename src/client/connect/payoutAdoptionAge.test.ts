import { expect, it } from "vitest";
import { oldestUnpaidFunding } from "./payoutAdoptionAge.js";
const source = (stripeTransferId: string, net: number, created: number) => ({
  stripeTransferId,
  currency: "usd",
  transactions: [{ net, created }],
});
it("ignores fully paid old funding and anchors a later unpaid credit", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [source("tr_old", 1000, 10), source("tr_new", 300, 100)],
      [{ stripeTransferId: "tr_old", amount: 1000 }],
      0,
    ),
  ).toBe(100000);
});
it("old refund debt consumes new funding without reviving the old holding age", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [source("tr_old", 900, 10), source("tr_new", 300, 100)],
      [{ stripeTransferId: "tr_old", amount: 1000 }],
      0,
    ),
  ).toBe(100000);
});
it("fees consume the oldest unpaid funds first", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [source("tr_old", 30, 10), source("tr_new", 300, 100)],
      [],
      30,
    ),
  ).toBe(100000);
});
it("anchors a fee credit after the original source was fully paid", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [
        {
          ...source("tr_old", 1000, 10),
          transactions: [
            { net: 1000, created: 10 },
            { net: 100, created: 100 },
          ],
        },
      ],
      [{ stripeTransferId: "tr_old", amount: 1000 }],
      0,
    ),
  ).toBe(100000);
});
it("returns no holding age when nothing is owed", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [source("tr_old", 1000, 10)],
      [{ stripeTransferId: "tr_old", amount: 1000 }],
      0,
    ),
  ).toBeUndefined();
});
it("does not offset another currency", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [
        { ...source("tr_eur", -1000, 10), currency: "eur" },
        source("tr_usd", 100, 20),
      ],
      [],
      0,
    ),
  ).toBe(20000);
});
it("returned bank cash starts a new holding age after the original funds left Stripe", () => {
  expect(
    oldestUnpaidFunding(
      "usd",
      [source("tr_old", 1000, 10)],
      [{ stripeTransferId: "tr_old", amount: 1000 }],
      0,
      [{ stripeTransferId: "tr_old", amount: 1000, created: 100 }],
    ),
  ).toBe(100000);
});
