import type { SplitTransfer } from "../core/fees.js";
export type SaleAllocationOptions = {
  gross: number;
  processingFee: number;
  /** Inclusive sale fee, with actual Stripe processing as its floor. */
  feeBasisPoints?: number | null;
  creatorAccountId: string;
  affiliate?: {
    destinationAccountId: string;
    basisPoints?: number;
    fixedAmount?: number;
  };
  collaborators?: { destinationAccountId: string; basisPoints: number }[];
};
export type SaleAllocation = {
  gross: number;
  processingFee: number;
  sellingFee: number;
  platformNet: number;
  affiliateNet: number;
  creatorNet: number;
  collaboratorNet: number;
  transfers: SplitTransfer[];
};
const basisPoints = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000)
    throw new Error("Share must be an integer from 0 to 10000 basis points.");
  return n;
};
const units = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(
      "Amounts must be non-negative safe integer currency units.",
    );
  return n;
};
const share = (amount: number, rate: number) =>
  Number((BigInt(amount) * BigInt(basisPoints(rate))) / 10000n);
/** Pure fee-first allocation. Fixed amounts are minor units of the sale currency. */
export function allocateSale(opts: SaleAllocationOptions): SaleAllocation {
  const gross = units(opts.gross),
    processingFee = units(opts.processingFee);
  if (processingFee > gross || !opts.creatorAccountId)
    throw new Error("Invalid gross amount, processing fee or creator account.");
  const rate = basisPoints(opts.feeBasisPoints ?? 0);
  const sellingFee = Math.max(
    processingFee,
    Number((BigInt(gross) * BigInt(rate) + 5000n) / 10000n),
  );
  const net = gross - sellingFee;
  const affiliate = opts.affiliate;
  if (
    affiliate &&
    (!affiliate.destinationAccountId ||
      (affiliate.fixedAmount !== undefined &&
        affiliate.basisPoints !== undefined))
  )
    throw new Error(
      "Choose one affiliate amount or percentage and a destination.",
    );
  const affiliateNet = affiliate
    ? Math.min(
        net,
        affiliate.fixedAmount !== undefined
          ? units(affiliate.fixedAmount)
          : share(net, affiliate.basisPoints ?? 0),
      )
    : 0;
  const creatorRemainder = net - affiliateNet;
  const collaborators = opts.collaborators ?? [];
  if (
    collaborators.reduce((sum, r) => sum + basisPoints(r.basisPoints), 0) >
    10000
  )
    throw new Error("Collaborator shares exceed the creator remainder.");
  const seen = new Set<string>();
  const transfers: SplitTransfer[] = collaborators.map((r) => {
    if (!r.destinationAccountId || seen.has(r.destinationAccountId))
      throw new Error("Collaborator destinations must be nonempty and unique.");
    seen.add(r.destinationAccountId);
    return {
      destinationAccountId: r.destinationAccountId,
      role: "other",
      amount: share(creatorRemainder, r.basisPoints),
    };
  });
  const collaboratorNet = transfers.reduce((sum, r) => sum + r.amount, 0);
  const creatorNet = creatorRemainder - collaboratorNet;
  transfers.unshift({
    destinationAccountId: opts.creatorAccountId,
    role: "store",
    amount: creatorNet,
  });
  if (affiliate)
    transfers.push({
      destinationAccountId: affiliate.destinationAccountId,
      role: "affiliate",
      amount: affiliateNet,
    });
  return {
    gross,
    processingFee,
    sellingFee,
    platformNet: sellingFee - processingFee,
    affiliateNet,
    creatorNet,
    collaboratorNet,
    transfers,
  };
}
