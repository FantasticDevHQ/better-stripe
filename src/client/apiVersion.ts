import { STRIPE_API_VERSION } from "./constants.js";
import { throwStripeError } from "./errors.js";
/** Explicit opt-in for Stripe's customer-only Accounts v2 public preview. */
export const STRIPE_CUSTOMER_PREVIEW_API_VERSION = "2026-09-30.preview";
export type SupportedStripeApiVersion =
  typeof STRIPE_API_VERSION | typeof STRIPE_CUSTOMER_PREVIEW_API_VERSION;
export function resolveStripeApiVersion(
  version?: string,
): SupportedStripeApiVersion {
  if (version === undefined) return STRIPE_API_VERSION;
  if (
    version === STRIPE_API_VERSION ||
    version === STRIPE_CUSTOMER_PREVIEW_API_VERSION
  )
    return version;
  throwStripeError(
    "INVALID_CONFIGURATION",
    `Unsupported Stripe API version. Use ${STRIPE_API_VERSION} or ${STRIPE_CUSTOMER_PREVIEW_API_VERSION}.`,
  );
}
