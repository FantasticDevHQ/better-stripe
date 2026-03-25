/**
 * React-specific types for the better-stripe component.
 * Re-exports component document types for convenience.
 */
export type {
  StripeComponentAccount,
  StripeComponentProduct,
  StripeComponentPrice,
  StripeComponentSubscription,
  StripeComponentCheckoutSession,
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
} from '../client/types/documents.js';

/** Props accepted by all headless better-stripe components */
export type BetterStripeComponentProps = {
  /** CSS class name for the outer wrapper element */
  className?: string;
};

/** Props for components that support Stripe Elements theming */
export type StripeThemeProps = {
  /** Stripe Appearance API theme object */
  theme?: Record<string, unknown>;
};

/** Standard loading state returned by all read hooks */
export type HookLoadingState = {
  isLoading: boolean;
};
