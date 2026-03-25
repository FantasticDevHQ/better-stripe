import { describe, expect, it } from 'vitest';

import { defaultStripeAppearance } from '../lib/stripe-element-styles.js';
import { createStripeElementsOptions } from './StripeProvider.js';

describe('createStripeElementsOptions', () => {
  it('includes appearance and a client secret for PaymentElement flows', () => {
    const appearance = { theme: 'flat' } as const;

    expect(
      createStripeElementsOptions({
        appearance,
        stripeOptions: {
          clientSecret: 'seti_123_secret_456',
          currency: 'usd',
        },
      }),
    ).toEqual({
      appearance,
      clientSecret: 'seti_123_secret_456',
      currency: 'usd',
    });
  });

  it('preserves mode-based Elements options', () => {
    expect(
      createStripeElementsOptions({
        elementsOptions: {
          mode: 'setup',
          currency: 'usd',
        },
      }),
    ).toEqual({
      appearance: defaultStripeAppearance,
      mode: 'setup',
      currency: 'usd',
    });
  });

  it('falls back to the package default appearance', () => {
    expect(createStripeElementsOptions({})).toEqual({
      appearance: defaultStripeAppearance,
    });
  });
});
