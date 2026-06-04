import Stripe from "stripe";

import { STRIPE_API_VERSION } from "../../client/constants.js";

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
 * Uses the component's pinned API version.
 */
export function getStripe(apiKey: string): Stripe {
  const cacheKey = `${apiKey}:${STRIPE_API_VERSION}`;
  let client = _clients.get(cacheKey);
  if (!client) {
    client = new Stripe(apiKey, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    });
    _clients.set(cacheKey, client);
  }
  return client;
}
