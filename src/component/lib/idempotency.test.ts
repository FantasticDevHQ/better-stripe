/**
 * Tests for generateIdempotencyKey — verifies deterministic, unique,
 * and correctly formatted idempotency keys for Stripe API operations.
 */
import { describe, expect, it } from 'vitest';

import { generateIdempotencyKey } from './idempotency';

describe('generateIdempotencyKey', () => {
  it('generates same key for identical operation and params', async () => {
    const firstKey = await generateIdempotencyKey('createSubscription', {
      customerId: 'cus_123',
    });
    const secondKey = await generateIdempotencyKey('createSubscription', {
      customerId: 'cus_123',
    });
    expect(firstKey).toBe(secondKey);
  });

  it('generates different keys for different params', async () => {
    const firstKey = await generateIdempotencyKey('createSubscription', {
      customerId: 'cus_123',
    });
    const secondKey = await generateIdempotencyKey('createSubscription', {
      customerId: 'cus_456',
    });
    expect(firstKey).not.toBe(secondKey);
  });

  it('produces a 32-character hex string', async () => {
    const key = await generateIdempotencyKey('checkout', {
      priceId: 'price_abc',
    });
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});
