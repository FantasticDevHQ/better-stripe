/** Canonical server-owned selectors. Shape validation is not host authorization or currency support. */
export type RefundCommandScope = {
  commandKey: string;
  accountId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  currency: string;
};

export function assertRefundCommandScope(input: RefundCommandScope): void {
  if (
    !/^[A-Za-z0-9:_-]{16,200}$/.test(input.commandKey) ||
    !/^acct_[A-Za-z0-9_]{1,128}$/.test(input.accountId) ||
    !/^pi_[A-Za-z0-9_]{1,252}$/.test(input.stripePaymentIntentId) ||
    !/^ch_[A-Za-z0-9_]{1,252}$/.test(input.stripeChargeId) ||
    !/^[a-z]{3}$/.test(input.currency)
  )
    throw new Error("Invalid refund command selectors");
}
