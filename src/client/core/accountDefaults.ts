/**
 * Default V2 account configuration: merchant with card_payments.
 */
export const DEFAULT_ACCOUNT_CONFIGURATION: Record<string, unknown> = {
  merchant: {
    capabilities: { card_payments: { requested: true } },
  },
};

export const DEFAULT_ACCOUNT_DEFAULTS: Record<string, unknown> = {
  responsibilities: {
    losses_collector: "application",
    fees_collector: "application",
  },
};
