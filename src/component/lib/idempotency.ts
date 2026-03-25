/**
 * Generate a deterministic idempotency key for a Stripe API write operation.
 * Same operation + params always produce the same key, enabling safe retries.
 *
 * Uses the Web Crypto API (available in Convex edge runtime, browsers, and Node 18+)
 * instead of Node's `crypto` module to avoid "use node" requirements.
 */
export async function generateIdempotencyKey(
  operation: string,
  params: Record<string, unknown>,
): Promise<string> {
  const payload = JSON.stringify({ operation, ...params });
  const encoded = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
