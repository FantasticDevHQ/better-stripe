/** A paid store must also be able to receive its sale proceeds. */
export function canReceiveStorePayments(
  account:
    | {
        configuration?: {
          recipient?: {
            capabilities?: {
              stripe_balance?: { stripe_transfers?: { status?: string } };
            };
          } | null;
        };
        capabilities?: { transfers?: string };
      }
    | null
    | undefined,
): boolean {
  return (
    account?.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status === "active" ||
    account?.capabilities?.transfers === "active"
  );
}
