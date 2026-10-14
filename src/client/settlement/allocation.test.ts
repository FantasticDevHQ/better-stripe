import { expect, it } from "vitest";
import { allocateSale } from "./allocation.js";
it("allocates processing and plan fees before affiliate and collaborators", () => {
  const result = allocateSale({
    gross: 10000,
    processingFee: 320,
    feeBasisPoints: 900,
    creatorAccountId: "acct_creator",
    affiliate: { destinationAccountId: "acct_affiliate", basisPoints: 2000 },
    collaborators: [{ destinationAccountId: "acct_other", basisPoints: 2500 }],
  });
  expect(result).toMatchObject({
    sellingFee: 900,
    platformNet: 580,
    affiliateNet: 1820,
    creatorNet: 5460,
    collaboratorNet: 1820,
  });
  expect(
    result.transfers.reduce((n, t) => n + t.amount, 0) + result.sellingFee,
  ).toBe(result.gross);
});
it("caps fixed commissions and applies the processing fee floor", () => {
  expect(
    allocateSale({
      gross: 10000,
      processingFee: 700,
      feeBasisPoints: 490,
      creatorAccountId: "acct_creator",
      affiliate: { destinationAccountId: "acct_a", fixedAmount: 99999 },
    }),
  ).toMatchObject({ affiliateNet: 9300, creatorNet: 0, platformNet: 0 });
  expect(
    allocateSale({
      gross: 12900,
      processingFee: 404,
      feeBasisPoints: 490,
      creatorAccountId: "acct_c",
      affiliate: { destinationAccountId: "acct_a", basisPoints: 2000 },
    }),
  ).toMatchObject({ affiliateNet: 2453, creatorNet: 9815 });
});
it("retains rounding residue for the creator and rejects invalid or duplicate shares", () => {
  const opts = {
    gross: 101,
    processingFee: 0,
    creatorAccountId: "acct_c",
    collaborators: [
      { destinationAccountId: "acct_a", basisPoints: 3333 },
      { destinationAccountId: "acct_b", basisPoints: 3333 },
    ],
  };
  expect(allocateSale(opts)).toMatchObject({
    creatorNet: 35,
    collaboratorNet: 66,
    affiliateNet: 0,
  });
  expect(() =>
    allocateSale({
      ...opts,
      collaborators: [{ destinationAccountId: "acct_a", basisPoints: 10001 }],
    }),
  ).toThrow();
  expect(() =>
    allocateSale({
      ...opts,
      collaborators: [opts.collaborators[0], opts.collaborators[0]],
    }),
  ).toThrow();
  expect(() => allocateSale({ ...opts, gross: 1.5 })).toThrow();
  expect(() =>
    allocateSale({
      ...opts,
      affiliate: {
        destinationAccountId: "acct_z",
        fixedAmount: 1,
        basisPoints: 1,
      },
    }),
  ).toThrow();
});
it("supports zero-dollar previews and zero affiliate shares", () => {
  expect(
    allocateSale({
      gross: 0,
      processingFee: 0,
      creatorAccountId: "acct_creator",
    }),
  ).toMatchObject({ gross: 0, creatorNet: 0, affiliateNet: 0, platformNet: 0 });
  expect(
    allocateSale({
      gross: 100,
      processingFee: 3,
      creatorAccountId: "acct_creator",
      affiliate: { destinationAccountId: "acct_a", basisPoints: 0 },
    }),
  ).toMatchObject({ creatorNet: 97, affiliateNet: 0 });
});
