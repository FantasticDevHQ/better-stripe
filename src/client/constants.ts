import type { StripeApiVersion } from "./stripe-types.js";

/**
 * The single source of truth for the Stripe API version this library targets.
 *
 * Bump this in ONE place when upgrading the Stripe SDK. It is typed as
 * {@link StripeApiVersion} — a literal derived from the installed SDK's own
 * constructor signature — so a value that drifts from the SDK fails to
 * compile and points you straight back here.
 *
 * Note: changing this is a behavioral/breaking change for the Convex
 * component (it pins every Stripe client it creates), so it warrants a
 * component release and changelog entry.
 */
export const STRIPE_API_VERSION: StripeApiVersion = "2026-05-27.dahlia";
