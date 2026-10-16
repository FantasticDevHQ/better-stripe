import { describe, expect, it } from "vitest";

import { computeSplit } from "../../../src/client/core/fees";
import {
  AFFILIATE_REFERRAL_CODE,
  AFFILIATE_SPLIT_PERCENT,
  STORE_SPLIT_PERCENT,
  buildSplitRecipients,
  isAffiliateReferral,
  netSplitAmounts,
} from "./affiliateSplit";

/**
 * The affiliate-split demo's attribution + split-leg logic (BTS-43) is pure and
 * deterministic, so it is unit-tested directly (the checkout it feeds needs a
 * live Stripe backend and is covered by the gated Playwright layer).
 */
describe("isAffiliateReferral", () => {
  it("matches the demo referral code, case- and whitespace-insensitively", () => {
    expect(isAffiliateReferral(AFFILIATE_REFERRAL_CODE)).toBe(true);
    expect(isAffiliateReferral("AVERY")).toBe(true);
    expect(isAffiliateReferral("  avery  ")).toBe(true);
  });

  it("rejects a missing or unrelated referral code", () => {
    expect(isAffiliateReferral(null)).toBe(false);
    expect(isAffiliateReferral(undefined)).toBe(false);
    expect(isAffiliateReferral("")).toBe(false);
    expect(isAffiliateReferral("someone-else")).toBe(false);
  });
});

describe("buildSplitRecipients", () => {
  const store = { accountId: "acct_maya", name: "Maya's Fitness Studio" };
  const affiliate = { accountId: "acct_avery", name: "Avery Affiliate" };

  it.each(["avery", null])(
    "reserves the platform fee before allocating net shares (%s)",
    (referralCode) => {
      const recipients = buildSplitRecipients({
        store,
        affiliate,
        referralCode,
      });
      const split = netSplitAmounts(recipients, 10000, 320);
      const result = computeSplit(10000, { percent: 2.9, fixed: 30 }, split);
      expect(result.transfers.map((t) => t.amount)).toEqual(
        referralCode ? [7744, 1936] : [9680],
      );
      expect(result.platformRetained).toBe(320);
      expect(
        result.transfers.reduce(
          (sum, t) => sum + t.amount,
          result.platformRetained,
        ),
      ).toBe(10000);
    },
  );

  it("keeps the final cent with the seller", () => {
    expect(
      netSplitAmounts(
        buildSplitRecipients({ store, affiliate, referralCode: "avery" }),
        2,
        1,
      ).map((t) => t.amount),
    ).toEqual([1, 0]);
  });

  it("routes store + affiliate legs on an attributed referral", () => {
    const legs = buildSplitRecipients({
      store,
      affiliate,
      referralCode: "avery",
    });
    expect(legs).toEqual([
      {
        destinationAccountId: "acct_maya",
        role: "store",
        percent: STORE_SPLIT_PERCENT,
      },
      {
        destinationAccountId: "acct_avery",
        role: "affiliate",
        percent: AFFILIATE_SPLIT_PERCENT,
      },
    ]);
    // Percents span the whole net, so store + affiliate + platform reconcile
    // to the charge (platform = charge − net).
    expect(STORE_SPLIT_PERCENT + AFFILIATE_SPLIT_PERCENT).toBe(100);
  });

  it("routes the store leg only when there is no referral", () => {
    const legs = buildSplitRecipients({ store, affiliate, referralCode: null });
    expect(legs).toEqual([
      { destinationAccountId: "acct_maya", role: "store", percent: 100 },
    ]);
  });

  it("routes the store leg only when the affiliate is unknown", () => {
    const legs = buildSplitRecipients({
      store,
      affiliate: null,
      referralCode: "avery",
    });
    expect(legs).toEqual([
      { destinationAccountId: "acct_maya", role: "store", percent: 100 },
    ]);
  });
});

it("allocates every remaining cent to the seller after the affiliate share", () => {
  const recipients = buildSplitRecipients({
    store: { accountId: "acct_seller", name: "Seller" },
    affiliate: { accountId: "acct_avery", name: "Avery" },
    referralCode: "avery",
  });
  const split = netSplitAmounts(recipients, 12900, 404);
  expect(split).toEqual([
    { destinationAccountId: "acct_seller", role: "store", amount: 9997 },
    { destinationAccountId: "acct_avery", role: "affiliate", amount: 2499 },
  ]);
  expect(split.reduce((sum, leg) => sum + leg.amount, 404)).toBe(12900);
});
