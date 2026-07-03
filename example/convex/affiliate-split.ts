/**
 * Affiliate-referral split demo (BTS-43) — pure attribution + split-leg logic.
 *
 * The headline proof: one $100 sale, three destinations (store / affiliate /
 * platform). This module holds only pure functions and constants so it can be
 * unit-tested and imported by BOTH the Convex action (which runs the split
 * checkout) and the React demo page (which shows the attribution) — it must
 * stay free of Convex server imports.
 */

/** The demo's referral code; a `?ref=avery` attributes the sale to Avery. */
export const AFFILIATE_REFERRAL_CODE = "avery";

/** The sale amount visualized by the demo ($100 in minor units). */
export const DEMO_SALE_AMOUNT = 10_000;

/** Store keeps this share of the net; the affiliate earns the remainder. */
export const STORE_SPLIT_PERCENT = 80;
export const AFFILIATE_SPLIT_PERCENT = 100 - STORE_SPLIT_PERCENT;

export type SplitPersona = { accountId: string; name: string };

export type DemoSplitRecipient = {
  destinationAccountId: string;
  role: "store" | "affiliate";
  percent: number;
};

/** True when the referral code attributes the sale to the demo affiliate. */
export function isAffiliateReferral(
  referralCode: string | null | undefined,
): boolean {
  return (referralCode ?? "").trim().toLowerCase() === AFFILIATE_REFERRAL_CODE;
}

/**
 * Build the split legs for the sale. Always routes the store leg; adds the
 * affiliate leg only when the referral attributes it and the affiliate is
 * known. Percents span the whole net (they sum to 100), so the platform fee is
 * taken first and store + affiliate + platform reconcile to the charge amount.
 */
export function buildSplitRecipients(opts: {
  store: SplitPersona;
  affiliate: SplitPersona | null;
  referralCode: string | null | undefined;
}): DemoSplitRecipient[] {
  if (opts.affiliate && isAffiliateReferral(opts.referralCode)) {
    return [
      {
        destinationAccountId: opts.store.accountId,
        role: "store",
        percent: STORE_SPLIT_PERCENT,
      },
      {
        destinationAccountId: opts.affiliate.accountId,
        role: "affiliate",
        percent: AFFILIATE_SPLIT_PERCENT,
      },
    ];
  }
  return [
    { destinationAccountId: opts.store.accountId, role: "store", percent: 100 },
  ];
}
