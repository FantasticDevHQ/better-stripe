import { describe, expect, it } from "vitest";

import {
  AFFILIATE_REFERRAL_CODE,
  AFFILIATE_SPLIT_PERCENT,
  STORE_SPLIT_PERCENT,
  buildSplitRecipients,
  isAffiliateReferral,
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

  it("routes store + affiliate legs on an attributed referral", () => {
    const legs = buildSplitRecipients({
      store,
      affiliate,
      referralCode: "avery",
    });
    expect(legs).toEqual([
      { destinationAccountId: "acct_maya", role: "store", percent: STORE_SPLIT_PERCENT },
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
