import { getChargeCurrencyMetadata } from "../charge-currency.js";

export type ProcessingCostDeficitOptions = {
  currency: string;
  gross: number;
  sellingFee: number;
  processingFee: number;
  principalReturned: number;
  disputeFees: number;
  liability: {
    processingCosts: "uncovered" | "all" | "none";
    disputeCosts: "all" | "none";
  };
  rounding: "nearest" | "floor" | "ceil";
};
export type ProcessingCostDeficit = {
  currency: string;
  retainedFee: number;
  processingLiability: number;
  disputeLiability: number;
  amountDue: number;
};

/**
 * Pure same-currency ledger calculation. Host selects liability and rounding.
 * All amounts are nonnegative integer API units, not decimal/display amounts.
 * This does not establish provider eligibility or create a charge/transfer.
 */
export function calculateProcessingCostDeficit(
  options: ProcessingCostDeficitOptions,
): ProcessingCostDeficit {
  if (!options || typeof options !== "object")
    throw new RangeError("Processing cost options are required.");
  const currency =
    typeof options.currency === "string"
      ? getChargeCurrencyMetadata(options.currency)
      : null;
  if (
    !currency ||
    [
      options.gross,
      options.sellingFee,
      options.processingFee,
      options.principalReturned,
      options.disputeFees,
    ].some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    options.gross === 0 ||
    options.sellingFee > options.gross ||
    !["nearest", "floor", "ceil"].includes(options.rounding) ||
    !["uncovered", "all", "none"].includes(
      options.liability?.processingCosts,
    ) ||
    !["all", "none"].includes(options.liability?.disputeCosts)
  )
    throw new RangeError(
      "Invalid processing cost amounts, currency or policy.",
    );

  const gross = BigInt(options.gross);
  const remaining =
    gross - BigInt(Math.min(options.gross, options.principalReturned));
  const numerator = BigInt(options.sellingFee) * remaining;
  const remainder = numerator % gross;
  const increment =
    options.rounding === "ceil"
      ? remainder > 0n
      : options.rounding === "nearest"
        ? 2n * remainder >= gross
        : false;
  const retainedFee = Number(numerator / gross + (increment ? 1n : 0n));
  const processingLiability =
    options.liability.processingCosts === "none"
      ? 0
      : options.liability.processingCosts === "all"
        ? options.processingFee
        : Math.max(0, options.processingFee - retainedFee);
  const disputeLiability =
    options.liability.disputeCosts === "all" ? options.disputeFees : 0;
  const amountDue = processingLiability + disputeLiability;
  if (!Number.isSafeInteger(amountDue))
    throw new RangeError(
      "Processing cost liability exceeds safe integer units.",
    );
  return {
    currency: currency.currency,
    retainedFee,
    processingLiability,
    disputeLiability,
    amountDue,
  };
}
