import Stripe from "stripe";

import {
  resolveStripeApiVersion,
  type SupportedStripeApiVersion,
} from "../../client/apiVersion.js";
import type { StripeApiVersion } from "../../client/stripe-types.js";

/**
 * Keyed cache for Stripe SDK instances.
 * Safe for tests and mixed environments — different keys get different clients.
 *
 * NOTE: This cache is unbounded and persists for the process lifetime.
 * In practice, a Convex component typically uses 1-2 keys (test + live).
 * API key rotation requires a process restart to pick up new keys.
 */
const _clients = new Map<string, Stripe>();

/**
 * Get or create a Stripe SDK instance for the given API key.
 * Defaults to GA; an explicitly selected supported preview gets its own cache entry.
 */
export function getStripe(
  apiKey: string,
  apiVersion?: SupportedStripeApiVersion,
): Stripe {
  const version = resolveStripeApiVersion(apiVersion);
  const cacheKey = `${apiKey}:${version}`;
  let client = _clients.get(cacheKey);
  if (!client) {
    client = new Stripe(apiKey, {
      apiVersion: version as StripeApiVersion,
      typescript: true,
    });
    _clients.set(cacheKey, client);
  }
  return client;
}
