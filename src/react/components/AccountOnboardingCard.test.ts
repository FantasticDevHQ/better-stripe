import { describe, expect, it } from 'vitest';

import { AccountOnboardingCard as BarrelExport } from '../index.js';
import { AccountOnboardingCard } from './AccountOnboardingCard.js';

describe('AccountOnboardingCard', () => {
  it('is a valid React component', () => {
    expect(typeof AccountOnboardingCard).toBe('function');
    expect(AccountOnboardingCard.name).toBe('AccountOnboardingCard');
  });

  it('accepts className prop without error', () => {
    // Verify the component function signature accepts expected props
    // by checking it does not throw when called with minimal valid props.
    // In edge-runtime without DOM, we verify the function itself is callable
    // and returns a value (React element or null).
    const result = AccountOnboardingCard({
      status: 'complete',
      className: 'custom-class',
    });
    expect(result).toBeDefined();
  });

  it('exports from the correct module via barrel', () => {
    expect(BarrelExport).toBe(AccountOnboardingCard);
  });
});
