import Stripe from "stripe";

import { type ActionCtx } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

// Match the API version the BetterStripe client pins, so the raw client used to
// seed a subscription speaks the same V2 dialect. Typed off the SDK's own
// constructor config (stripe@22 no longer re-exports an ApiVersion literal).
export type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;

export const STRIPE_API_VERSION: StripeApiVersion = "2026-09-30.endive";

/**
 * Core demo personas (BTS-7 added the visitor). Each role is a singleton, so
 * `seedDb` looks each one up by role and inserts only what's missing — a re-run
 * against a partially-seeded deployment (e.g. one first seeded before the
 * visitor persona existed, BTS-113) backfills the gap rather than silently
 * no-op'ing on the whole batch. Keep this seed step before anything that may
 * insert shared-role users (e.g. marketplace sellers): the `by_role` lookup
 * below intentionally assumes these four core roles have not yet been claimed.
 */
export const CORE_PERSONAS = [
  { name: "Alex Customer", email: "alex@example.com", role: "customer" },
  { name: "Jordan Seller", email: "jordan@example.com", role: "seller" },
  { name: "Sam Admin", email: "sam@example.com", role: "admin" },
  // Visitor: a user with no Stripe account yet — `seedAccounts` deliberately
  // leaves this persona unlinked so the app can demonstrate the pre-onboarding
  // (gated, no-billing-data) state.
  { name: "Riley Visitor", email: "riley@example.com", role: "visitor" },
] as const;

/**
 * Marketplace personas (BTS-41). Two sellers who each own a store, an
 * affiliate who earns referral transfers, and a buyer who purchases from the
 * platform catalog. Emails double as the idempotency keys in
 * `seedMarketplaceDb`.
 */
export const MARKETPLACE_PERSONAS = [
  {
    name: "Maya Merchant",
    email: "maya@example.com",
    role: "seller",
    storeName: "Maya's Fitness Studio",
  },
  {
    name: "Sasha Studio",
    email: "sasha@example.com",
    role: "seller",
    storeName: "Sasha's Ceramics",
  },
  { name: "Avery Affiliate", email: "avery@example.com", role: "affiliate" },
  { name: "Billie Buyer", email: "billie@example.com", role: "buyer" },
] as const;

// =============================================================================
// Marketplace scenario (BTS-41)
// =============================================================================

/**
 * Activate a fresh test recipient's `stripe_balance.stripe_transfers`
 * capability entirely via API, so seeded transfers/splits succeed without
 * hosted onboarding. TEST MODE ONLY: the recipe (validated in the BTS-9/BTS-10
 * spikes) is a `dashboard: none` account + test SSN `000000000` (auto-verifies
 * in the sandbox) + an RFC3339 ToS attestation + a business URL. Express/full
 * dashboard accounts reject API ToS acceptance and must onboard via Stripe.
 */
export async function activateTestRecipient(
  ctx: ActionCtx,
  stripeAccountId: string,
): Promise<void> {
  await stripe.updateV2Account(ctx, {
    stripeAccountId,
    updateParams: {
      identity: {
        entity_type: "individual",
        individual: {
          given_name: "Test",
          surname: "Recipient",
          date_of_birth: { day: 1, month: 1, year: 1990 },
          address: {
            line1: "354 Oyster Point Blvd",
            city: "South San Francisco",
            state: "CA",
            postal_code: "94080",
            country: "US",
          },
          id_numbers: [{ type: "us_ssn", value: "000000000" }],
        },
        attestations: {
          terms_of_service: {
            account: {
              date: new Date().toISOString(),
              ip: "127.0.0.1",
            },
          },
        },
      },
      defaults: {
        profile: { business_url: "https://accessible.stripe.com" },
      },
    },
  });
}
