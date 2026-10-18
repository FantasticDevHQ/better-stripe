import type { SplitTransfer } from "../core/fees.js";
import type { ResolvedSettlement } from "./execution.js";

type Source = Readonly<Omit<ResolvedSettlement, "transfers">>;
export type SettlementAuthorizationContext =
  | {
      phase: "reserve";
      settlement: Source & {
        readonly transfers: readonly Readonly<SplitTransfer>[];
      };
    }
  | {
      phase: "transfer";
      settlement: Source;
      transfer: Readonly<SplitTransfer>;
    };
/** Server-only check. Throw to deny; returning never changes the allocation. */
export type SettlementAuthorization = (
  context: SettlementAuthorizationContext,
) => Promise<void>;

/** Detached snapshots prevent host callbacks from modifying claimed economics. */
export async function authorizeSettlement(
  authorize: SettlementAuthorization | undefined,
  settlement: ResolvedSettlement,
  transfer?: SplitTransfer,
) {
  if (!authorize) return;
  const source = structuredClone({
    sourceChargeId: settlement.sourceChargeId,
    paymentIntentId: settlement.paymentIntentId,
    sourceInvoiceId: settlement.sourceInvoiceId,
    usageSource: settlement.usageSource,
    creditSource: settlement.creditSource,
    gross: settlement.gross,
    currency: settlement.currency,
    processingFee: settlement.processingFee,
    platformNet: settlement.platformNet,
    adjustmentAmount: settlement.adjustmentAmount,
    paymentId: settlement.paymentId,
  });
  await authorize(
    transfer
      ? { phase: "transfer", settlement: source, transfer: { ...transfer } }
      : {
          phase: "reserve",
          settlement: {
            ...source,
            transfers: structuredClone(settlement.transfers),
          },
        },
  );
}
