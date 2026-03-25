/**
 * Tests for the better-stripe/react barrel export — verifies all documented
 * hook factories, components, and utilities are exported correctly.
 */
import { describe, expect, it } from 'vitest';

import * as ReactExports from './index.js';

describe('better-stripe/react barrel export', () => {
  it('exports all documented hook factories', () => {
    const hookFactories = [
      'createUseAccount',
      'createUseProducts',
      'createUsePrices',
      'createUseSubscription',
      'createUseSubscriptions',
      'createUseCheckout',
      'createUsePaymentMethods',
      'createUseInvoices',
      'createUseAccountOnboarding',
      'useStripePublishableKey',
      'useStripeMode',
    ] as const;
    for (const name of hookFactories) {
      expect(ReactExports).toHaveProperty(name);
      expect(typeof ReactExports[name]).toBe('function');
    }
  });

  it('exports all documented components', () => {
    const components = [
      'StripeProvider',
      'CheckoutSessionProvider',
      'EmbeddedCheckout',
      'CheckoutStatus',
      'PricePicker',
      'PriceCard',
      'IntervalSelector',
      'SubscriptionCard',
      'SubscriptionLineItems',
      'PriceBadge',
      'TrialAlert',
      'BillingPortalLink',
      'AddCardForm',
      'PaymentMethodsList',
      'DeletePaymentMethodDialog',
      'ConnectStatusBadge',
      'AccountOnboardingCard',
      'AccountCreateCard',
      'AccountLoginCard',
      'ConnectRequirements',
    ] as const;
    for (const name of components) {
      expect(ReactExports).toHaveProperty(name);
      expect(typeof ReactExports[name]).toBe('function');
    }
  });

  it('exports checkout session hook and types', () => {
    expect(ReactExports).toHaveProperty('useCheckoutSession');
    expect(typeof ReactExports.useCheckoutSession).toBe('function');
  });

  it('exports payment confirmation hook', () => {
    expect(ReactExports).toHaveProperty('useConfirmPayment');
    expect(typeof ReactExports.useConfirmPayment).toBe('function');
  });

  it('exports payment method action hook', () => {
    expect(ReactExports).toHaveProperty('usePaymentMethodActions');
    expect(typeof ReactExports.usePaymentMethodActions).toBe('function');
  });

  it('exports re-exported Stripe Elements components', () => {
    const stripeElements = [
      'PaymentElement',
      'ElementsPaymentElement',
      'CardElement',
      'CardNumberElement',
      'CardExpiryElement',
      'CardCvcElement',
    ] as const;
    for (const name of stripeElements) {
      expect(ReactExports).toHaveProperty(name);
    }
  });

  it('exports theme factory and presets', () => {
    expect(ReactExports).toHaveProperty('createStripeAppearance');
    expect(typeof ReactExports.createStripeAppearance).toBe('function');

    expect(ReactExports).toHaveProperty('createStripeElementStyles');
    expect(typeof ReactExports.createStripeElementStyles).toBe('function');

    expect(ReactExports).toHaveProperty('defaultStripeAppearance');
    expect(ReactExports).toHaveProperty('darkStripeAppearance');
  });

  it('exports utilities expected by consumers', () => {
    const utilities = [
      'formatPrice',
      'formatPriceWithInterval',
      'filterPricesByInterval',
      'sortPricesByAmount',
      'deriveSubscriptionState',
      'getSubscriptionStatusLabel',
      'daysUntil',
      'getRequirementKey',
      'getRequirementLabel',
      'getStripeDashboardUrl',
      'isStripeTestMode',
    ] as const;
    for (const name of utilities) {
      expect(ReactExports).toHaveProperty(name);
    }
  });

  it('createStripeAppearance returns valid Stripe Appearance', () => {
    const appearance = ReactExports.createStripeAppearance({
      primary: '#18181b',
      background: '#ffffff',
      text: '#0a0a0a',
      danger: '#ef4444',
    });

    expect(appearance).toHaveProperty('theme');
    expect(appearance).toHaveProperty('variables');
    expect(appearance).toHaveProperty('rules');
    expect(appearance.variables).toHaveProperty('colorPrimary', '#18181b');
    expect(appearance.variables).toHaveProperty('colorBackground', '#ffffff');
    expect(appearance.variables).toHaveProperty('colorText', '#0a0a0a');
    expect(appearance.variables).toHaveProperty('colorDanger', '#ef4444');
  });

  it('createStripeAppearance uses defaults for missing tokens', () => {
    const appearance = ReactExports.createStripeAppearance();

    expect(appearance.theme).toBe('flat');
    expect(appearance.variables).toHaveProperty('colorPrimary');
    expect(appearance.variables).toHaveProperty('borderRadius', '8px');
  });

  it('createStripeAppearance supports dark base theme', () => {
    const dark = ReactExports.createStripeAppearance({ baseTheme: 'night' });

    expect(dark.theme).toBe('night');
    expect(dark.variables).toHaveProperty('colorPrimary', '#7c3aed');
  });

  it('createStripeElementStyles returns inline style config', () => {
    const styles = ReactExports.createStripeElementStyles({
      text: '#0a0a0a',
      textSecondary: '#737373',
    });

    expect(styles).toHaveProperty('style');
    expect(styles.style).toHaveProperty('base');
    expect(styles.style).toHaveProperty('invalid');
    expect(styles.style).toHaveProperty('empty');
    expect(styles.style.base).toHaveProperty('color', '#0a0a0a');
  });

  it('defaultStripeAppearance and darkStripeAppearance are valid', () => {
    expect(ReactExports.defaultStripeAppearance.theme).toBe('flat');
    expect(ReactExports.darkStripeAppearance.theme).toBe('night');
  });
});
