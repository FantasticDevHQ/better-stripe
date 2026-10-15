import { expect, it } from "vitest";
import { createUseCurrencyEarnings } from "./useCurrencyEarnings.js";
it("joins exact server totals by currency without summing preview rows", () => {
  const earnings = {
    totals: [
      {
        currency: "jpy",
        gross: 1000,
        reversed: 100,
        net: 900,
        transferCount: 99,
      },
    ],
    transfers: [],
  };
  const payouts = {
    totals: [{ currency: "usd", paidOut: 50, payoutCount: 20 }],
    payouts: [],
  };
  const useEarnings = createUseCurrencyEarnings(
    (ref) => (ref === "earnings" ? earnings : payouts),
    "earnings",
    "payouts",
  );
  expect(useEarnings("acct_a").totals).toEqual([
    {
      currency: "jpy",
      gross: 1000,
      reversed: 100,
      net: 900,
      transferCount: 99,
      paidOut: 0,
      payoutCount: 0,
    },
    {
      currency: "usd",
      gross: 0,
      reversed: 0,
      net: 0,
      transferCount: 0,
      paidOut: 50,
      payoutCount: 20,
    },
  ]);
});
it("skips unresolved accounts and distinguishes loading from empty totals", () => {
  const args: unknown[] = [];
  const hook = createUseCurrencyEarnings(
    (_ref, value) => {
      args.push(value);
      return undefined;
    },
    "earnings",
    "payouts",
  );
  expect(hook(undefined)).toMatchObject({ totals: [], isLoading: false });
  expect(args).toEqual(["skip", "skip"]);
  expect(hook("acct_a").isLoading).toBe(true);
});
