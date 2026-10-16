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
