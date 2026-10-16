/** Provider capability shape shared by V1 and V2 accounts. */
export type TransferCapabilityAccount = {
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: { stripe_transfers?: { status?: string } };
      };
    } | null;
  } | null;
  capabilities?: { transfers?: string } | null;
};

/** True when Stripe reports active recipient transfers in either supported API shape. */
export function canReceiveTransfers(
  account: TransferCapabilityAccount | null | undefined,
): boolean {
  return (
    account?.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status === "active" ||
    account?.capabilities?.transfers === "active"
  );
}
