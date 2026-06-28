import type {
  FeeOverride,
  FeeTier,
  PlatformFeeConfig,
} from "../types/options.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Invalid platformFee config: ${message}`);
  }
}

function validatePercent(percent: number, ctx: string): void {
  assert(
    Number.isFinite(percent) && percent >= 0 && percent <= 100,
    `${ctx} percent must be a number between 0 and 100 (got ${percent})`,
  );
}

function validateFixed(fixed: number | undefined, ctx: string): void {
  if (fixed !== undefined) {
    assert(
      Number.isInteger(fixed) && fixed >= 0,
      `${ctx} fixed must be a non-negative integer in minor units (got ${fixed})`,
    );
  }
}

/**
 * Validate a {@link PlatformFeeConfig} at construction time. Throws on:
 * percent out of 0–100, negative fixed, or a tier schedule that is empty,
 * out of range, non-ascending/overlapping, or has a non-final catch-all.
 */
export function validatePlatformFee(config: PlatformFeeConfig): void {
  validatePercent(config.percent, "base");
  validateFixed(config.fixed, "base");

  const { tiers } = config;
  if (tiers !== undefined) {
    assert(tiers.length > 0, "tiers must be non-empty when provided");
    let prevUpper = 0;
    tiers.forEach((tier, i) => {
      validatePercent(tier.percent, `tier ${i}`);
      validateFixed(tier.fixed, `tier ${i}`);
      const isLast = i === tiers.length - 1;
      if (tier.upTo === null) {
        assert(
          isLast,
          "a null upTo (catch-all) is only allowed as the last tier",
        );
      } else {
        assert(
          Number.isInteger(tier.upTo) && tier.upTo > 0,
          `tier ${i} upTo must be a positive integer in minor units or null`,
        );
        assert(
          tier.upTo > prevUpper,
          `tier ${i} upTo must be strictly greater than the previous tier (tiers must be ascending and non-overlapping)`,
        );
        prevUpper = tier.upTo;
      }
    });
  }
}

/**
 * Resolve which fee config applies for a charge. Precedence: per-call override
 * → global default. (Per-product / per-seller sources slot in here later.)
 * Returns `undefined` when no fee is configured at any level.
 */
export function resolveFeeConfig(
  defaultConfig?: PlatformFeeConfig,
  override?: FeeOverride,
): PlatformFeeConfig | undefined {
  const resolved = override ?? defaultConfig;
  // A per-call override bypasses the constructor's validation, so re-validate
  // the effective config here to enforce the same contract everywhere.
  if (resolved !== undefined) {
    validatePlatformFee(resolved);
  }
  return resolved;
}

/**
 * True when a fee is a flat percentage that Stripe's `application_fee_percent`
 * can express directly (no fixed surcharge, no tiers). Percent+fixed/tiered
 * fees must be computed per charge/invoice instead.
 */
export function isPercentOnlyFee(config: PlatformFeeConfig): boolean {
  return !config.fixed && (!config.tiers || config.tiers.length === 0);
}

/** The platform fee computed for a specific charge amount. */
export type FeeBreakdown = {
  /** Fee in minor units (never greater than the charge amount). */
  feeAmount: number;
  /** Percentage actually applied (from the matched tier, or the base). */
  percentApplied: number;
  /** Fixed surcharge actually applied, in minor units. */
  fixedApplied: number;
  /** The tier that matched, when a tiered schedule was used. */
  tier?: FeeTier;
};

/**
 * Compute the platform fee for a charge `amount` (minor units) under `config`.
 *
 * - Tiered: picks the first tier whose inclusive `upTo` covers the amount
 *   (final `upTo: null` is the catch-all); otherwise uses the base percent/fixed.
 * - `feeAmount = round(amount * percent / 100) + fixed`, **rounded half-up** to
 *   whole minor units, and **capped at `amount`** (the fee can never exceed the
 *   charge).
 * - Returns a zero fee for non-positive amounts (e.g. a trial with no charge).
 *
 * Assumes `amount` and the config's minor-unit fields share one currency.
 * Validate `config` (see {@link validatePlatformFee}) before calling.
 */
export function computeFee(
  amount: number,
  config: PlatformFeeConfig,
): FeeBreakdown {
  if (!(amount > 0)) {
    return { feeAmount: 0, percentApplied: 0, fixedApplied: 0 };
  }

  let percent = config.percent;
  let fixed = config.fixed ?? 0;
  let tier: FeeTier | undefined;
  if (config.tiers) {
    tier = config.tiers.find((t) => t.upTo === null || amount <= t.upTo);
    if (tier) {
      percent = tier.percent;
      fixed = tier.fixed ?? 0;
    }
  }

  // Math.round is half-up for the non-negative values we deal with here.
  const raw = Math.round((amount * percent) / 100) + fixed;
  const feeAmount = Math.min(raw, amount);

  return { feeAmount, percentApplied: percent, fixedApplied: fixed, tier };
}
