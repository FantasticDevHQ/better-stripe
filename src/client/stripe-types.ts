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

// =============================================================================
// Stripe constructor config — apiVersion type
// =============================================================================

/**
 * The exact `apiVersion` literal the installed Stripe SDK targets.
 *
 * In stripe@22.1+, `StripeConfig.apiVersion` is typed as the current
 * `LatestApiVersion` literal rather than plain `string`. Because stripe
 * does not re-export `LatestApiVersion` through the `Stripe` namespace,
 * we extract it from the new Stripe instance constructor shape via the
 * SDK's own typings (Stripe has a static `API_VERSION: string`, but we
 * need the literal — so we use the config accepted by the class).
 *
 * Callers pinning to a specific API version should cast their string
 * through this type (or just pass the literal directly) to satisfy the
 * tightened constructor types.
 */
// Stripe is imported type-only at the top of this file; to access the
// constructor via `typeof`, we need the value side. Re-importing as a
// value here is a pure type-level trick — `StripeValue` is only used
// inside a `typeof` expression, so no runtime code is emitted.
import StripeValue from "stripe";
export type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof StripeValue>[1]>["apiVersion"]
>;
