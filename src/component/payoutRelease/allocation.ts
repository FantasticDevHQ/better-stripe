export type PayoutFundingSource = {
  stripeTransferId: string;
  currency: string;
  matureNet: number;
  paidAmount: number;
  reservedAmount: number;
  pendingCredits: number;
  role?: "store" | "affiliate" | "other";
};
export type PayoutAllocationOptions = {
  currency: string;
  threshold: number;
  providerAvailable: number;
  independentLiabilities: number;
  confirmedFees?: number;
  sources: PayoutFundingSource[];
};
export type RecipientPayoutPlan = {
  currency: string;
  matureUnpaid: number;
  pendingCredits: number;
  /** Stripe does not expose a reliable numeric floor for every account. */
  providerMinimum: null;
} & (
  | {
      status: "held";
      reason: "below_threshold" | "insufficient_available";
      amount: 0;
    }
  | {
      status: "qualified";
      amount: number;
      allocations: {
        stripeTransferId: string;
        amount: number;
        role?: PayoutFundingSource["role"];
      }[];
    }
);
function money(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Unsafe payout arithmetic.");
  return value;
}
function nonnegative(value: number) {
  if (money(value) < 0) throw new Error("Invalid payout accounting amount.");
}
function currency(value: string) {
  if (value.length !== 3 || !/^[a-z]{3}$/.test(value))
    throw new Error("Invalid payout currency.");
}
/**
 * Pure allocation step, not authorization to call Stripe. Inputs must be a
 * complete, verified still-unpaid snapshot for this recipient. Policy controls,
 * source ownership/maturity, prior payout adoption, independent liabilities and
 * atomic reservations must be established by the execution boundary.
 *
 * Negative source entitlement survives refunds after payout. Pending credits
 * never qualify. Each source's reservations reduce entitlement; they are not
 * subtracted again from fresh provider availability, which may already include
 * the provider debit for those same in-flight payouts.
 */
export function planRecipientPayout(
  opts: PayoutAllocationOptions,
): RecipientPayoutPlan {
  currency(opts.currency);
  if (money(opts.threshold) <= 0) throw new Error("Invalid payout threshold.");
  money(opts.providerAvailable);
  nonnegative(opts.independentLiabilities);
  nonnegative(opts.confirmedFees ?? 0);
  const seen = new Set<string>();
  for (const source of opts.sources) {
    if (
      !/^tr_\w+$/.test(source.stripeTransferId) ||
      source.stripeTransferId.trim() !== source.stripeTransferId ||
      source.stripeTransferId.length > 100
    )
      throw new Error("Invalid payout source identity.");
    if (seen.has(source.stripeTransferId))
      throw new Error("Duplicate payout source.");
    seen.add(source.stripeTransferId);
    currency(source.currency);
    money(source.matureNet);
    nonnegative(source.paidAmount);
    nonnegative(source.reservedAmount);
    nonnegative(source.pendingCredits);
    if (
      source.role !== undefined &&
      !["store", "affiliate", "other"].includes(source.role)
    )
      throw new Error("Invalid payout source role.");
  }
  const sources = opts.sources
    .filter((source) => source.currency === opts.currency)
    .sort((a, b) =>
      a.stripeTransferId < b.stripeTransferId
        ? -1
        : a.stripeTransferId > b.stripeTransferId
          ? 1
          : 0,
    );
  let matureUnpaid = 0;
  let pendingCredits = 0;
  const credits = sources.map((source) => {
    const unpaid = money(
      money(source.matureNet - source.paidAmount) - source.reservedAmount,
    );
    matureUnpaid = money(matureUnpaid + unpaid);
    pendingCredits = money(pendingCredits + source.pendingCredits);
    return { source, unpaid };
  });
  matureUnpaid = money(
    money(matureUnpaid - (opts.confirmedFees ?? 0)) -
      opts.independentLiabilities,
  );
  const totals = {
    currency: opts.currency,
    matureUnpaid,
    pendingCredits,
    providerMinimum: null,
  };
  const providerAvailable = money(
    opts.providerAvailable - opts.independentLiabilities,
  );
  if (matureUnpaid < opts.threshold)
    return { ...totals, status: "held", reason: "below_threshold", amount: 0 };
  const amount = Math.min(matureUnpaid, providerAvailable);
  if (amount < opts.threshold)
    return {
      ...totals,
      status: "held",
      reason: "insufficient_available",
      amount: 0,
    };
  let remaining = amount;
  const allocations: Extract<
    RecipientPayoutPlan,
    { status: "qualified" }
  >["allocations"] = [];
  for (const { source, unpaid } of credits) {
    const allocated = Math.min(Math.max(0, unpaid), remaining);
    if (allocated) {
      allocations.push({
        stripeTransferId: source.stripeTransferId,
        amount: allocated,
        ...(source.role === undefined ? {} : { role: source.role }),
      });
      remaining = money(remaining - allocated);
    }
  }
  if (remaining !== 0) throw new Error("Invalid payout source allocation.");
  return { ...totals, status: "qualified", amount, allocations };
}
