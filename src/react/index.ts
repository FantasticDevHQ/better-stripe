/**
 * better-stripe/react — React hooks and headless UI components
 *
 * Entry point for the React layer of the better-stripe Convex component.
 * Import from '@getdojo/better-stripe/react' to access hooks and components.
 */

// Types
export type {
  BetterStripeComponentProps,
  HookLoadingState,
  StripeThemeProps,
} from "./types.js";

// Re-export document types for convenience
export type {
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
  StripeComponentPrice,
  StripeComponentProduct,
  StripeComponentSubscription,
  StripeComponentDispute,
} from "./types.js";

// Hook factories
export { createUseAccount } from "./hooks/useAccount.js";
export { createUseProducts } from "./hooks/useProducts.js";
export { createUsePrices } from "./hooks/usePrices.js";
export { createUseSubscription } from "./hooks/useSubscription.js";
export { createUseSubscriptions } from "./hooks/useSubscriptions.js";
export { createUseCheckout } from "./hooks/useCheckout.js";
export { createUsePaymentMethods } from "./hooks/usePaymentMethods.js";
export { createUseInvoices } from "./hooks/useInvoices.js";
export { createUseDisputes } from "./hooks/useDisputes.js";
export type { UseDisputesResult } from "./hooks/useDisputes.js";
export { createUseDisputeWithCountdown } from "./hooks/useDisputeWithCountdown.js";
export type {
  DisputeEvidenceCountdown,
  DisputeWithCountdown,
  UseDisputeWithCountdownResult,
} from "./hooks/useDisputeWithCountdown.js";
// Hook factories — Earnings & splits (BTS-36)
export { createUseEarnings } from "./hooks/useEarnings.js";
export type {
  EarningsTransfer,
  UseEarningsResult,
} from "./hooks/useEarnings.js";
export { createUseSplitBreakdown } from "./hooks/useSplitBreakdown.js";
export type {
  SplitBreakdown,
  SplitBreakdownLeg,
  UseSplitBreakdownResult,
} from "./hooks/useSplitBreakdown.js";
export { createUseAccountOnboarding } from "./hooks/useAccountOnboarding.js";
export { useStripePublishableKey } from "./hooks/useStripePublishableKey.js";
export { useStripeMode } from "./hooks/useStripeMode.js";
export {
  getStripeDashboardUrl,
  isStripeTestMode,
  STRIPE_DASHBOARD_BASE_URL,
  StripeDashboardResourcePath,
} from "../client/utils/stripeDashboardUrl.js";
export type {
  StripeDashboardResourceType,
  StripeMode,
} from "../client/utils/stripeDashboardUrl.js";

// Hooks — Config
export { useStripeConfig } from "./hooks/useStripeConfig.js";
export type { StripeConfig } from "./hooks/useStripeConfig.js";

// Components — Provider
export { StripeProvider } from "./components/StripeProvider.js";
export { StripeProviderWithKey } from "./components/StripeProviderWithKey.js";
export type { StripeProviderWithKeyProps } from "./components/StripeProviderWithKey.js";
export { CheckoutSessionProvider } from "./components/CheckoutSessionProvider.js";
export type { CheckoutSessionProviderProps } from "./components/CheckoutSessionProvider.js";
export { CheckoutSessionProviderWithKey } from "./components/CheckoutSessionProviderWithKey.js";
export type { CheckoutSessionProviderWithKeyProps } from "./components/CheckoutSessionProviderWithKey.js";

// Hooks — Checkout Session
export { useCheckoutSession } from "./hooks/useCheckoutSession.js";
export type {
  CheckoutSessionState,
  CheckoutConfirmResult,
} from "./hooks/useCheckoutSession.js";

// Hooks — Payment Confirmation
export { useConfirmPayment } from "./hooks/useConfirmPayment.js";
export type { StripeConfirmResult } from "./hooks/useConfirmPayment.js";

// Hooks — Payment Method Actions
export { usePaymentMethodActions } from "./hooks/usePaymentMethodActions.js";
export type {
  PaymentMethodActionCallbacks,
  PaymentMethodCard,
  CreatePaymentMethodResult,
} from "./hooks/usePaymentMethodActions.js";

// Re-export Stripe Elements components and hooks used by checkout/payment flows
export {
  PaymentElement as ElementsPaymentElement,
  CardElement,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
export { PaymentElement } from "@stripe/react-stripe-js/checkout";

// Components — Checkout & Subscription
export { EmbeddedCheckout } from "./components/EmbeddedCheckout.js";
export { CheckoutStatus } from "./components/CheckoutStatus.js";
export { PricePicker } from "./components/PricePicker.js";
export { PriceCard } from "./components/PriceCard.js";
export { IntervalSelector } from "./components/IntervalSelector.js";
export { SubscriptionActions } from "./components/SubscriptionActions.js";
export type {
  SubscriptionActionsProps,
  SubscriptionActionsRenderProps,
} from "./components/SubscriptionActions.js";
export { SubscriptionCard } from "./components/SubscriptionCard.js";
export { SubscriptionLineItems } from "./components/SubscriptionLineItems.js";
export { PriceBadge } from "./components/PriceBadge.js";
export { TrialAlert } from "./components/TrialAlert.js";
export { BillingPortalLink } from "./components/BillingPortalLink.js";

// Components — Payment Methods
export { AddCardForm } from "./components/AddCardForm.js";
export { PaymentMethodActions } from "./components/PaymentMethodActions.js";
export type {
  PaymentMethodActionsProps,
  PaymentMethodActionsRenderProps,
} from "./components/PaymentMethodActions.js";
export { PaymentMethodsList } from "./components/PaymentMethodsList.js";
export type {
  PaymentMethodItem,
  PaymentMethodsListProps,
} from "./components/PaymentMethodsList.js";
export { DeletePaymentMethodDialog } from "./components/DeletePaymentMethodDialog.js";

// Components — Disputes
export { ConnectProvider } from "./components/ConnectProvider.js";
export type { ConnectProviderProps } from "./components/ConnectProvider.js";
export { EmbeddedDisputes } from "./components/EmbeddedDisputes.js";
export type { EmbeddedDisputesProps } from "./components/EmbeddedDisputes.js";
export { DisputesList } from "./components/DisputesList.js";
export type {
  DisputesListProps,
  DisputesListRow,
  DisputesListRowContext,
} from "./components/DisputesList.js";
export { DisputeDetail } from "./components/DisputeDetail.js";
export type {
  DisputeDetailProps,
  DisputeDetailRenderProps,
} from "./components/DisputeDetail.js";
export { EvidenceForm } from "./components/EvidenceForm.js";
export type {
  DisputeEvidenceFields,
  EvidenceFormProps,
  EvidenceFormRenderProps,
  EvidenceFormUpdateArgs,
} from "./components/EvidenceForm.js";

// Components — Payouts (BTS-38)
export { PayoutSchedule } from "./components/PayoutSchedule.js";
export type {
  PayoutScheduleProps,
  PayoutScheduleRenderProps,
  RecipientBalance,
} from "./components/PayoutSchedule.js";

// Components — Connect / Merchant
export { ConnectStatusBadge } from "./components/ConnectStatusBadge.js";
export type {
  ConnectStatus,
  ConnectStatusDetails,
  ConnectStatusBadgeProps,
  ConnectStatusBadgeRenderProps,
} from "./components/ConnectStatusBadge.js";
export { AccountOnboardingCard } from "./components/AccountOnboardingCard.js";
export type {
  AccountOnboardingCardProps,
  AccountOnboardingCardRenderProps,
} from "./components/AccountOnboardingCard.js";
export { AccountCreateCard } from "./components/AccountCreateCard.js";
export type {
  AccountCreateCardProps,
  AccountCreateCardRenderProps,
  AccountCreateCountry,
} from "./components/AccountCreateCard.js";
export { AccountLoginCard } from "./components/AccountLoginCard.js";
export type {
  AccountLoginCardProps,
  AccountLoginCardRenderProps,
} from "./components/AccountLoginCard.js";
export { AccountCloseButton } from "./components/AccountCloseButton.js";
export type {
  AccountCloseButtonProps,
  AccountCloseButtonRenderProps,
} from "./components/AccountCloseButton.js";
export { AccountCloseCard } from "./components/AccountCloseCard.js";
export type {
  AccountCloseCardProps,
  AccountCloseCardRenderProps,
} from "./components/AccountCloseCard.js";
export { AccountCreateButton } from "./components/AccountCreateButton.js";
export type {
  AccountCreateButtonProps,
  AccountCreateButtonRenderProps,
} from "./components/AccountCreateButton.js";
export { AccountLoginButton } from "./components/AccountLoginButton.js";
export type {
  AccountLoginButtonProps,
  AccountLoginButtonRenderProps,
} from "./components/AccountLoginButton.js";
export { AccountOnboardingButton } from "./components/AccountOnboardingButton.js";
export type {
  AccountOnboardingButtonProps,
  AccountOnboardingButtonRenderProps,
} from "./components/AccountOnboardingButton.js";
export { ConnectRequirements } from "./components/ConnectRequirements.js";
export type {
  ConnectRequirementsProps,
  ConnectRequirementsRenderProps,
  StructuredRequirements,
  EnrichedRequirement,
} from "./components/ConnectRequirements.js";

// Utilities
export {
  formatPrice,
  formatPriceWithInterval,
  filterPricesByInterval,
  sortPricesByAmount,
} from "./lib/price-helpers.js";
export {
  deriveSubscriptionState,
  getSubscriptionStatusLabel,
  daysUntil,
} from "./lib/subscription-helpers.js";
export {
  createStripeAppearance,
  createStripeElementStyles,
  defaultStripeAppearance,
  darkStripeAppearance,
} from "./lib/stripe-element-styles.js";
export type { StripeAppearanceConfig } from "./lib/stripe-element-styles.js";
export {
  getRequirementKey,
  getRequirementLabel,
} from "./lib/connect-requirement-keys.js";
