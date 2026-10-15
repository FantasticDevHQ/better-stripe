import { expect, it } from "vitest";
import { validateHistoricalFunding } from "./payoutAdoptionAllocation.js";
const source = {
  stripeTransferId: "tr_one",
  currency: "usd",
  transactions: [
    {
      amount: 1000,
      fee: 0,
      net: 1000,
      created: 10,
      availableOn: 20,
      status: "available",
    },
  ],
};
const payout = {
  stripePayoutId: "po_one",
  currency: "usd",
  amount: 1000,
  created: 30,
  allocations: [{ stripeTransferId: "tr_one", amount: 1000 }],
};
it("validates exact historical funding without requiring it to remain unpaid now", () => {
  expect(() =>
    validateHistoricalFunding(
      [
        {
          ...source,
          transactions: [
            ...source.transactions,
            {
              amount: -500,
              fee: 0,
              net: -500,
              created: 40,
              availableOn: 50,
              status: "available",
            },
          ],
        },
      ],
      [payout],
    ),
  ).not.toThrow();
});
it("rejects funding from a transfer not mature at the payout date", () => {
  expect(() =>
    validateHistoricalFunding(
      [
        {
          ...source,
          transactions: [{ ...source.transactions[0], availableOn: 31 }],
        },
      ],
      [payout],
    ),
  ).toThrow(/funding/i);
});
it("rejects paying the same historical source twice", () => {
  expect(() =>
    validateHistoricalFunding(
      [source],
      [payout, { ...payout, stripePayoutId: "po_two", created: 40 }],
    ),
  ).toThrow(/funding/i);
});
it("a returned payout restores source capacity only at actual return maturity", () => {
  const first = { ...payout, returnedAt: 50 };
  expect(() =>
    validateHistoricalFunding(
      [source],
      [first, { ...payout, stripePayoutId: "po_two", created: 45 }],
    ),
  ).toThrow(/funding/i);
  expect(() =>
    validateHistoricalFunding(
      [source],
      [first, { ...payout, stripePayoutId: "po_two", created: 50 }],
    ),
  ).not.toThrow();
});
it("cannot use a future positive fee adjustment to fund an older payout", () => {
  expect(() =>
    validateHistoricalFunding(
      [
        {
          ...source,
          transactions: [
            { ...source.transactions[0], net: 900 },
            {
              net: 100,
              created: 40,
              availableOn: 40,
              status: "available",
            },
          ],
        },
      ],
      [payout],
    ),
  ).toThrow(/funding/i);
});
it("does not net currencies", () => {
  expect(() =>
    validateHistoricalFunding([{ ...source, currency: "eur" }], [payout]),
  ).toThrow(/currency/i);
});
it("requires exact principal allocations", () => {
  expect(() =>
    validateHistoricalFunding([source], [{ ...payout, amount: 999 }]),
  ).toThrow(/principal/i);
});
it("rejects duplicate payouts or duplicate source allocations", () => {
  expect(() => validateHistoricalFunding([source], [payout, payout])).toThrow(
    /duplicate/i,
  );
  expect(() =>
    validateHistoricalFunding(
      [source],
      [
        {
          ...payout,
          allocations: [
            { stripeTransferId: "tr_one", amount: 500 },
            { stripeTransferId: "tr_one", amount: 500 },
          ],
        },
      ],
    ),
  ).toThrow(/duplicate/i);
});
