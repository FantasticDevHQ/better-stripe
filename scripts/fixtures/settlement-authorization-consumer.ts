import type {
  BetterStripe,
  SettleSaleOptions,
  SettlementAuthorization,
  SettlementAuthorizationContext,
} from "@fantastic.dev/better-stripe";

type Context = Parameters<BetterStripe["settleSale"]>[0];
/** Host derives original identities and rechecks them inside this server-only callback. */
export function settlementAdapter(
  sdk: BetterStripe,
  ctx: Context,
  input: SettleSaleOptions,
  check: (context: SettlementAuthorizationContext) => Promise<void>,
) {
  const authorize: SettlementAuthorization = async (context) => {
    await check(context);
    const originalCharge: string = context.settlement.sourceChargeId;
    if (!originalCharge) throw new Error("Original charge is required");
    if (context.phase === "reserve") {
      for (const leg of context.settlement.transfers)
        if (!leg.destinationAccountId) throw new Error("Recipient is required");
    } else {
      const amount: number = context.transfer.amount;
      if (amount < 0) throw new Error("Invalid transfer amount");
    }
  };
  return sdk.settleSale(ctx, { ...input, authorize });
}

/** Recovery options stay runtime-only; original sealed group admission is separate. */
export function recoveryAdapter(
  sdk: BetterStripe,
  ctx: Context,
  request: Parameters<BetterStripe["costRecovery"]["executeGroupProvider"]>[1],
  options: Parameters<BetterStripe["costRecovery"]["executeGroupProvider"]>[2],
  authorize: SettlementAuthorization,
) {
  return sdk.costRecovery.executeGroupProvider(ctx, request, {
    ...options,
    authorize,
  });
}
