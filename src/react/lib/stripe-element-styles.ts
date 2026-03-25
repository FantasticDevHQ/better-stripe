import type { Appearance } from '@stripe/stripe-js';

/**
 * Configuration for creating a Stripe Appearance object.
 * Pass hex color values — Stripe does not support CSS custom properties or OKLCH.
 */
export type StripeAppearanceConfig = {
  /** Primary accent color (buttons, focus rings) */
  primary?: string;
  /** Background color of inputs and containers */
  background?: string;
  /** Primary text color */
  text?: string;
  /** Secondary/muted text color */
  textSecondary?: string;
  /** Error/danger color */
  danger?: string;
  /** Border color for inputs */
  border?: string;
  /** Border radius for inputs (e.g. '8px') */
  borderRadius?: string;
  /** Font family string */
  fontFamily?: string;
  /** Base font size (e.g. '14px') */
  fontSize?: string;
  /** Spacing unit (e.g. '4px') */
  spacingUnit?: string;
  /** Stripe base theme */
  baseTheme?: 'stripe' | 'flat' | 'night';
};

const DEFAULT_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const LIGHT_DEFAULTS: Required<StripeAppearanceConfig> = {
  primary: '#0570de',
  background: '#ffffff',
  text: '#30313d',
  textSecondary: '#737373',
  danger: '#df1b41',
  border: '#e0e0e0',
  borderRadius: '8px',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: '14px',
  spacingUnit: '4px',
  baseTheme: 'flat',
};

const DARK_DEFAULTS: Required<StripeAppearanceConfig> = {
  primary: '#7c3aed',
  background: '#1a1a2e',
  text: '#e2e8f0',
  textSecondary: '#a3a3a3',
  danger: '#ef4444',
  border: '#27272a',
  borderRadius: '8px',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: '14px',
  spacingUnit: '4px',
  baseTheme: 'night',
};

/**
 * Create a Stripe Appearance object from color tokens.
 *
 * Apps pass their own hex color values (e.g. OKLCH-derived values);
 * this factory returns a complete Stripe Appearance config.
 *
 * @example
 * ```tsx
 * // Custom branded appearance
 * const appearance = createStripeAppearance({
 *   primary: '#18181b',
 *   background: '#ffffff',
 *   text: '#0a0a0a',
 *   textSecondary: '#737373',
 *   danger: '#ef4444',
 *   border: '#e4e4e7',
 * });
 *
 * <StripeProvider publishableKey={pk} appearance={appearance}>
 *   ...
 * </StripeProvider>
 * ```
 */
export function createStripeAppearance(
  config: StripeAppearanceConfig = {},
): Appearance {
  const defaults =
    config.baseTheme === 'night' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
  const c = { ...defaults, ...config };

  return {
    theme: c.baseTheme,
    variables: {
      colorPrimary: c.primary,
      colorBackground: c.background,
      colorText: c.text,
      colorTextSecondary: c.textSecondary,
      colorDanger: c.danger,
      borderRadius: c.borderRadius,
      fontSizeBase: c.fontSize,
      fontFamily: c.fontFamily,
      spacingUnit: c.spacingUnit,
    },
    rules: {
      '.Input': {
        padding: '10px 12px',
        border: `1px solid ${c.border}`,
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      },
      '.Input:focus': {
        borderColor: c.primary,
        boxShadow: `0 0 0 1px ${c.primary}`,
      },
      '.Input--invalid': {
        borderColor: c.danger,
        boxShadow: `0 0 0 1px ${c.danger}`,
      },
      '.Label': {
        fontSize: c.fontSize,
        fontWeight: '500',
        color: c.text,
      },
    },
  };
}

/**
 * Inline styles for individual Stripe Elements (CardNumber, CardExpiry, CardCvc).
 * Use with the `style` option on individual element components.
 *
 * @example
 * ```tsx
 * const styles = createStripeElementStyles({ text: '#0a0a0a', textSecondary: '#737373' });
 * <CardNumberElement options={styles} />
 * ```
 */
export function createStripeElementStyles(
  config: Pick<
    StripeAppearanceConfig,
    'text' | 'textSecondary' | 'danger' | 'fontFamily' | 'fontSize'
  > = {},
) {
  const text = config.text ?? LIGHT_DEFAULTS.text;
  const placeholder = config.textSecondary ?? LIGHT_DEFAULTS.textSecondary;
  const danger = config.danger ?? LIGHT_DEFAULTS.danger;
  const fontFamily = config.fontFamily ?? LIGHT_DEFAULTS.fontFamily;
  const fontSize = config.fontSize ?? LIGHT_DEFAULTS.fontSize;

  return {
    style: {
      base: {
        fontSize,
        fontFamily,
        color: text,
        backgroundColor: 'transparent',
        '::placeholder': { color: placeholder },
        ':focus': { color: text },
      },
      invalid: {
        color: danger,
        iconColor: danger,
      },
      empty: {
        color: placeholder,
      },
    },
  };
}

/** Default light Stripe Elements appearance. */
export const defaultStripeAppearance = createStripeAppearance();

/** Dark mode Stripe Elements appearance. */
export const darkStripeAppearance = createStripeAppearance({
  baseTheme: 'night',
});
