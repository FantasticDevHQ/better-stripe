import { captureReversal } from "../reversalObservations/capture.js";
import {
  deferTransferFacts,
  synchronousTransferFactLimit,
} from "../financialObservations/transferBatches.js";
import { observeTransfer } from "../financialObservations/transfers.js";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { computeReversalSlices } from "../lib/reversals.js";
import {
  applyCommissionExposure,
  applyObligationExposure,
} from "../settlement/clawbacks.js";
import { commissionExposureValidator } from "../settlement/clawbackSchema.js";
import type { Infer } from "convex/values";
/** How `claimReversalSlices` sizes each leg's slice. */
const reversalModeValidator = v.union(
  v.object({ kind: v.literal("full") }),
  v.object({ kind: v.literal("percent"), percent: v.number() }),
  v.object({ kind: v.literal("amount"), amount: v.number() }),
  v.object({
    kind: v.literal("fraction"),
    chargeAmount: v.number(),
    amountRefunded: v.number(),
  }),
);

/**
 * Atomically claim reversal slices for one operation (a dispute or refund
 * clawback) BEFORE any money moves (BTS-63). Runs in a single transaction, so
 * concurrent operations serialize here instead of racing between the ledger
 * read and the Stripe call:
 *
 *  - First claim for an `operationId`: computes slices against each leg's
 *    claim frontier (`max(reversedAmount, reversalClaimedAmount)`), advances
 *    the frontier, and records the slices — atomically. A concurrent distinct
 *    operation claiming the same target gets an EMPTY claim, not a duplicate.
 *  - Any later call with the same `operationId` (webhook redelivery, retry
 *    after a partial failure) replays the recorded slices verbatim, so the
 *    caller re-sends byte-identical Stripe params under the same idempotency
 *    keys no matter how the ledger moved in between.
 *
 * Each returned slice carries the leg's current CONFIRMED `reversedAmount` so
 * the executor can skip slices whose money already moved and was recorded.
 */
export const claimReversalSlicesDefinition = {
  args: {
    operationId: v.string(),
    sourceChargeId: v.string(),
    mode: reversalModeValidator,
    commissionExposure: v.optional(commissionExposureValidator),
  },
  returns: v.object({
    replay: v.boolean(),
    slices: v.array(
      v.object({
        stripeTransferId: v.string(),
        from: v.number(),
        to: v.number(),
        confirmed: v.number(),
        commissionTracked: v.optional(v.boolean()),
      }),
    ),
  }),
  handler: async (
    ctx: MutationCtx,
    args: {
      operationId: string;
      sourceChargeId: string;
      mode: Infer<typeof reversalModeValidator>;
      commissionExposure?: Infer<typeof commissionExposureValidator>;
    },
  ) => {
    const confirmedFor = async (stripeTransferId: string) => {
      const row = await ctx.db
        .query("transfers")
        .withIndex("by_stripe_transfer_id", (q) =>
          q.eq("stripeTransferId", stripeTransferId),
        )
        .first();
      return row?.reversedAmount ?? 0;
    };

    const isAffiliate = async (stripeTransferId: string) => {
      const row = await ctx.db
        .query("transfers")
        .withIndex("by_stripe_transfer_id", (q) =>
          q.eq("stripeTransferId", stripeTransferId),
        )
        .unique();
      return row?.role === "affiliate";
    };
    // Fail atomically rather than commit a partial recovery beyond the bound.
    const chargeRows = await ctx.db
      .query("transfers")
      .withIndex("by_source_charge_id", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .take(1001);
    if (chargeRows.length > 1000)
      throw new Error("Charge transfer recovery limit exceeded.");
    const rows = chargeRows.filter((t) => !t.reinstatement);

    const existingOp = await ctx.db
      .query("transferReversalOps")
      .withIndex("by_operation_id", (q) =>
        q.eq("operationId", args.operationId),
      )
      .first();
    const exposure =
      existingOp?.commissionExposure && args.commissionExposure
        ? {
            ...existingOp.commissionExposure,
            finalized:
              existingOp.commissionExposure.finalized ||
              args.commissionExposure.finalized,
            disputeState:
              args.commissionExposure.disputeState ??
              existingOp.commissionExposure.disputeState,
            refundedPrincipal: args.commissionExposure.refundedPrincipal,
          }
        : existingOp
          ? undefined
          : args.commissionExposure;
    const targets = new Map<string, number>();
    if (exposure) {
      for (const transfer of rows)
        if (transfer.role === "affiliate")
          targets.set(
            transfer.stripeTransferId,
            await applyCommissionExposure(ctx, transfer, exposure),
          );
      const untransferred = await ctx.db
        .query("affiliateObligations")
        .withIndex("by_charge", (q) =>
          q.eq("sourceChargeId", args.sourceChargeId),
        )
        .take(1001);
      if (untransferred.length > 1000)
        throw new Error("Affiliate obligation limit exceeded.");
      for (const row of untransferred)
        if (!row.stripeTransferId)
          await applyObligationExposure(ctx, row, exposure);
    }
    if (existingOp) {
      if (existingOp.sourceChargeId !== args.sourceChargeId)
        throw new Error("Reversal operation source identity cannot change.");
      if (existingOp.commissionExposure && args.commissionExposure) {
        if (
          existingOp.commissionExposure.kind !== args.commissionExposure.kind ||
          existingOp.commissionExposure.chargeAmount !==
            args.commissionExposure.chargeAmount
        )
          throw new Error("Commission operation identity cannot change.");
        if (exposure)
          await ctx.db.patch("transferReversalOps", existingOp._id, {
            commissionExposure: exposure,
          });
      }
      await captureReversal(ctx, {
        ...existingOp,
        ...(existingOp.commissionExposure && exposure
          ? { commissionExposure: exposure }
          : {}),
      });
      const slices = [];
      for (const s of existingOp.slices) {
        slices.push({
          ...s,
          confirmed: await confirmedFor(s.stripeTransferId),
          ...(existingOp.commissionExposure
            ? { commissionTracked: await isAffiliate(s.stripeTransferId) }
            : {}),
        });
      }
      return { replay: true, slices };
    }

    const byId = new Map(rows.map((r) => [r.stripeTransferId, r]));
    let slices = computeReversalSlices(
      rows.map((t) => ({
        stripeTransferId: t.stripeTransferId,
        amount: t.amount,
        frontier: Math.max(t.reversedAmount ?? 0, t.reversalClaimedAmount ?? 0),
      })),
      args.mode,
    );

    if (args.commissionExposure) {
      // Keep the shipped seller/other paths; affiliates converge on original
      // commission exposure rather than a second incremental dispute debit.
      const affiliates = rows.filter((t) => t.role === "affiliate");
      slices = slices.filter(
        (s) => byId.get(s.stripeTransferId)!.role !== "affiliate",
      );
      for (const transfer of affiliates) {
        const target = Math.min(
          transfer.amount,
          targets.get(transfer.stripeTransferId) ?? 0,
        );
        const from = Math.max(
          transfer.reversedAmount ?? 0,
          transfer.reversalClaimedAmount ?? 0,
        );
        if (target > from)
          slices.push({
            stripeTransferId: transfer.stripeTransferId,
            from,
            to: target,
          });
      }
    }

    for (const s of slices) {
      await ctx.db.patch("transfers", byId.get(s.stripeTransferId)!._id, {
        reversalClaimedAmount: s.to,
      });
      if (slices.length <= synchronousTransferFactLimit)
        await observeTransfer(
          ctx,
          (await ctx.db.get("transfers", byId.get(s.stripeTransferId)!._id))!,
        );
    }
    // Record the operation even when it claims nothing, so a redelivery is a
    // deterministic no-op instead of a recomputation against newer state.
    const operationId = await ctx.db.insert("transferReversalOps", {
      operationId: args.operationId,
      sourceChargeId: args.sourceChargeId,
      slices,
      ...(args.commissionExposure
        ? { commissionExposure: args.commissionExposure }
        : {}),
    });

    const observedOperation = (await ctx.db.get(
      "transferReversalOps",
      operationId,
    ))!;
    await captureReversal(ctx, observedOperation, false, rows);
    if (slices.length > synchronousTransferFactLimit)
      await deferTransferFacts(
        ctx,
        observedOperation,
        slices.map((s) => byId.get(s.stripeTransferId)!._id),
        "transfer_frontier_claim",
      );

    return {
      replay: false,
      slices: slices.map((s) => ({
        ...s,
        confirmed: byId.get(s.stripeTransferId)!.reversedAmount ?? 0,
        ...(args.commissionExposure
          ? {
              commissionTracked:
                byId.get(s.stripeTransferId)!.role === "affiliate",
            }
          : {}),
      })),
    };
  },
};
