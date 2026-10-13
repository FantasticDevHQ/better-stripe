/** Only costs not already covered by the retained inclusive sale fee are owed. */
export function stripeCostDeficit(args: {
  gross: number;
  sellingFee: number;
  processingFee: number;
  principalReturned: number;
  disputeFees: number;
}): number {
  if (
    Object.values(args).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    args.gross <= 0
  )
    throw new Error("Invalid Stripe cost amounts.");
  const returned = Math.min(args.gross, args.principalReturned);
  const retainedFee = Math.round(
    (args.sellingFee * (args.gross - returned)) / args.gross,
  );
  return Math.max(0, args.processingFee - retainedFee) + args.disputeFees;
}
/** Net account credits first, then collect only what this payout can cover. */
export function allocateSellerCosts(
  outstanding: number[],
  available: number,
  creditLimit: number,
) {
  if (
    outstanding.some((n) => !Number.isSafeInteger(n)) ||
    !Number.isSafeInteger(available) ||
    available < 0 ||
    !Number.isSafeInteger(creditLimit) ||
    creditLimit < 0
  )
    throw new Error("Invalid cost allocation.");
  const positive = outstanding.reduce(
    (sum, amount) => sum + Math.max(0, amount),
    0,
  );
  const negative = outstanding.reduce(
    (sum, amount) => sum + Math.max(0, -amount),
    0,
  );
  const net = positive - negative;
  const recovery =
    net >= 0 ? Math.min(available, net) : -Math.min(creditLimit, -net);
  let positiveLeft = Math.min(positive, negative) + Math.max(0, recovery);
  let negativeLeft = Math.min(positive, negative) + Math.max(0, -recovery);
  const allocations = outstanding.map((amount) => {
    if (amount > 0) {
      const take = Math.min(amount, positiveLeft);
      positiveLeft -= take;
      return take;
    }
    const take = Math.min(-amount, negativeLeft);
    negativeLeft -= take;
    return take === 0 ? 0 : -take;
  });
  return { recovery, allocations };
}
