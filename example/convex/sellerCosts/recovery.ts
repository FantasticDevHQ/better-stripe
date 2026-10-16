export const costClaimKey = (paymentIntentId: string) =>
  `example:cost:${paymentIntentId}`;
export const costScope = (
  sellerId: string,
  accountId: string,
  currency: string,
) => ({ accountId, scopeKey: `example:store:${sellerId}`, currency });
