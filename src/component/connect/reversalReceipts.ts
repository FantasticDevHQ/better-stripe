import { updateObligation } from "../affiliateRecovery/accounting.js";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { deriveReversalState } from "../lib/reversals.js";

async function recordCommissionReceipt(
  ctx: MutationCtx,
  transfer: Doc<"transfers">,
  reversedAmount: number,
  receipt: { stripeReversalId: string; operationId: string; amount: number },
) {
  const op = await ctx.db
    .query("transferReversalOps")
    .withIndex("by_operation_id", (q) =>
      q.eq("operationId", receipt.operationId),
    )
    .unique();
  const slice = op?.slices.find(
    (s) => s.stripeTransferId === transfer.stripeTransferId,
  );
  if (
    transfer.role !== "affiliate" ||
    !op?.commissionExposure ||
    !slice ||
    receipt.amount !== slice.to - slice.from ||
    reversedAmount !== slice.to ||
    !receipt.stripeReversalId
  )
    throw new Error(
      "Commission reversal receipt does not match its reserved operation.",
    );
  const priorOperationReceipt = await ctx.db
    .query("affiliateReversalReceipts")
    .withIndex("by_transfer_operation", (q) =>
      q
        .eq("stripeTransferId", transfer.stripeTransferId)
        .eq("operationId", receipt.operationId),
    )
    .unique();
  if (
    priorOperationReceipt &&
    priorOperationReceipt.stripeReversalId !== receipt.stripeReversalId
  )
    throw new Error(
      "Commission operation already has a different reversal receipt.",
    );
  const existing = await ctx.db
    .query("affiliateReversalReceipts")
    .withIndex("by_receipt", (q) =>
      q.eq("stripeReversalId", receipt.stripeReversalId),
    )
    .unique();
  if (existing) {
    if (
      existing.stripeTransferId !== transfer.stripeTransferId ||
      existing.operationId !== receipt.operationId ||
      existing.amount !== receipt.amount
    )
      throw new Error("Commission reversal receipt identity cannot change.");
  } else {
    await ctx.db.insert("affiliateReversalReceipts", {
      ...receipt,
      stripeTransferId: transfer.stripeTransferId,
    });
  }
}

export const recordTransferReversalDefinition = {
  args: {
    stripeTransferId: v.string(),
    reversedAmount: v.number(),
    receipt: v.optional(
      v.object({
        stripeReversalId: v.string(),
        operationId: v.string(),
        amount: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    args: {
      stripeTransferId: string;
      reversedAmount: number;
      receipt?: {
        stripeReversalId: string;
        operationId: string;
        amount: number;
      };
    },
  ) => {
    const transfer = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", args.stripeTransferId),
      )
      .first();

    if (!transfer) {
      throw new Error(
        `Cannot record reversal: no transfer found for ${args.stripeTransferId}`,
      );
    }

    // `reversedAmount` is a cumulative total (matches Stripe's
    // `Transfer.amount_reversed`). Keep it monotonic so a stale/out-of-order
    // event can't shrink it or undo a full reversal.
    const reversedAmount = Math.max(
      transfer.reversedAmount ?? 0,
      args.reversedAmount,
    );
    const derived = deriveReversalState(
      transfer.amount,
      reversedAmount,
      transfer.status,
    );

    if (
      !Number.isSafeInteger(reversedAmount) ||
      reversedAmount < 0 ||
      reversedAmount > transfer.amount
    )
      throw new Error("Invalid confirmed transfer reversal amount.");
    if (args.receipt)
      await recordCommissionReceipt(
        ctx,
        transfer,
        args.reversedAmount,
        args.receipt,
      );
    await ctx.db.patch("transfers", transfer._id, derived);
    const obligation = await ctx.db
      .query("affiliateObligations")
      .withIndex("by_transfer", (q) =>
        q.eq("stripeTransferId", args.stripeTransferId),
      )
      .unique();
    if (obligation)
      await updateObligation(ctx, obligation, {
        recoveredAmount: reversedAmount,
      });

    return null;
  },
};
