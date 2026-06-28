import type {
  FeeOverride,
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
