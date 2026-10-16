/**
 * Recipient-only account configuration, applied at creation time via hosted
 * Express onboarding. Distinct from `DEFAULT_ACCOUNT_CONFIGURATION`
 * (`merchant`-only) used by `createAccountWithOnboarding`'s default — this
 * demo models the marketplace/Skool seller (transfers/payouts recipient),
 * not a merchant-of-record. Mirrors the capability shape
 * `addRecipientConfiguration` applies internally.
 */
export const RECIPIENT_ACCOUNT_CONFIGURATION = {
  recipient: {
    capabilities: {
      stripe_balance: { stripe_transfers: { requested: true } },
    },
  },
};
