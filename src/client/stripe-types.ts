/**
 * Stripe SDK v22 type extraction utilities.
 *
 * In stripe@22, param types (e.g. AccountCreateParams) are no longer
 * re-exported through the top-level Stripe namespace. We extract them
 * from the SDK method signatures using Parameters<> utility types.
 *
 * Object types (e.g. Account, Session) still work via the namespace
 * (Stripe.V2.Core.Account, Stripe.Checkout.Session).
 */
import type Stripe from "stripe";

// =============================================================================
// V2 CORE — Account param types
// =============================================================================

export type V2AccountCreateParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["create"]>[0]
>;

export type V2AccountUpdateParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["update"]>[1]
>;

export type V2AccountRetrieveParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["retrieve"]>[1]
>;

export type V2AccountListParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["list"]>[0]
>;

export type V2AccountCloseParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["close"]>[1]
>;

// =============================================================================
// V2 CORE — Account Link param types
// =============================================================================

export type V2AccountLinkCreateParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accountLinks"]["create"]>[0]
>;

// =============================================================================
// V2 CORE — Account sub-types (via indexed access)
// =============================================================================

export type V2Account = Stripe.V2.Core.Account;

export type V2AccountRequirements = NonNullable<V2Account["requirements"]>;
export type V2AccountRequirementsEntry = NonNullable<
  V2AccountRequirements["entries"]
>[number];

export type V2AccountConfiguration = NonNullable<V2Account["configuration"]>;
export type V2AccountConfigCustomer = NonNullable<
  V2AccountConfiguration["customer"]
>;
export type V2AccountConfigMerchant = NonNullable<
  V2AccountConfiguration["merchant"]
>;

export type V2AccountRetrieveInclude = NonNullable<
  V2AccountRetrieveParams["include"]
>[number];

export type V2AppliedConfiguration =
  V2Account["applied_configurations"][number];

export type V2CloseAppliedConfiguration = NonNullable<
  V2AccountCloseParams["applied_configurations"]
>[number];

// =============================================================================
// Checkout — Session param types
// =============================================================================

export type CheckoutSessionCreateParams = NonNullable<
  Parameters<Stripe["checkout"]["sessions"]["create"]>[0]
>;
