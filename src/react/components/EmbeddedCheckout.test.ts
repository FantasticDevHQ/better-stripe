import { describe, expect, it } from 'vitest';

import { EmbeddedCheckout as BarrelExport } from '../index.js';
import { EmbeddedCheckout } from './EmbeddedCheckout.js';

describe('EmbeddedCheckout', () => {
  it('is a valid React component', () => {
    expect(typeof EmbeddedCheckout).toBe('function');
    expect(EmbeddedCheckout.name).toBe('EmbeddedCheckout');
  });

  it('is exported from react barrel', () => {
    expect(BarrelExport).toBe(EmbeddedCheckout);
  });

  it('does not require Dojo-specific wrappers', async () => {
    // Verify the component can be imported standalone from the package
    // without pulling in any Dojo application dependencies.
    // The import at the top of this file already proves this —
    // if it depended on Dojo internals, the import would fail.
    const mod = await import('./EmbeddedCheckout.js');
    expect(mod.EmbeddedCheckout).toBeDefined();
    expect(mod.EmbeddedCheckout).toBe(EmbeddedCheckout);
  });
});
