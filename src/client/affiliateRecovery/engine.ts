import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  classifyRecoveryError,
  findReceipt,
  verifyConnectPath,
  type RecoveryObligation,
  type RecoveryOperation,
} from "./provider.js";
export async function reconcileObligation(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  obligationId: string,
) {
  let row = (await ctx.runQuery(
    componentRef(component, "affiliateRecovery/queries/getObligation"),
    { obligationId },
  )) as RecoveryObligation | null;
  if (!row || row.needsReconciliation)
    return {
      state: "unsupported",
      reason: "Original commission provenance requires reconciliation.",
    };
  // Finish uncertain recovery before restoring its actual proceeds. Each pass
  // claims one immutable operation atomically with debt/offset reservations.
  let lastState = "settled";
  for (let pass = 0; pass < 2; pass++) {
    const net =
      row.recoveredAmount + (row.offsetAmount ?? 0) - (row.restoredAmount ?? 0);
    const kind =
      net > row.finalizedAmount + row.provisionalAmount
        ? "restoration"
        : "recovery";
    const op = (await runMutationOrThrow(
      ctx,
      componentRef(component, "affiliateRecovery/mutations/reserveOperation"),
      { obligationId, kind, now: Date.now() },
    )) as RecoveryOperation | null;
    if (!op) {
      if ((row.debtAmount ?? 0) > 0) lastState = "offset_required";
      break;
    }
    try {
      const receiptId = op.attempted
        ? await findReceipt(stripe, op, row)
        : null;
      if (!receiptId && op.attempted && op.kind === "recovery") {
        const original = await stripe.transfers.retrieve(row.stripeTransferId!);
        if (
          original.amount_reversed >
          (op.providerBaseline ?? row.recoveredAmount)
        ) {
          const error =
            "Provider reversal aggregate changed without an attributable operation receipt; operator receipt review is required.";
          await runMutationOrThrow(
            ctx,
            componentRef(
              component,
              "affiliateRecovery/mutations/completeOperation",
            ),
            { operationId: op._id, state: "unknown", error },
          );
          return { state: "unknown", error };
        }
      }
      let confirmed = receiptId;
      if (!confirmed) {
        const started = (await runMutationOrThrow(
          ctx,
          componentRef(component, "affiliateRecovery/mutations/beginOperation"),
          { operationId: op._id },
        )) as RecoveryOperation;
        if (!["pending", "unknown"].includes(started.state)) {
          lastState = started.state;
          if (started.state === "canceled") {
            row = (await ctx.runQuery(
              componentRef(
                component,
                "affiliateRecovery/queries/getObligation",
              ),
              { obligationId },
            )) as RecoveryObligation;
            continue;
          }
          break;
        }
        const capability = await verifyConnectPath(stripe, row, op.kind);
        if (!capability.supported) {
          await runMutationOrThrow(
            ctx,
            componentRef(
              component,
              "affiliateRecovery/mutations/completeOperation",
            ),
            {
              operationId: op._id,
              state: op.attempted ? "unknown" : "unsupported",
              error: capability.reason,
            },
          );
          return {
            state: op.attempted ? "unknown" : "unsupported",
            reason: capability.reason,
          };
        }
        const metadata = {
          bsRecoveryOperation: op._id,
          bsOriginalCharge: row.sourceChargeId,
        };
        if (op.kind === "recovery") {
          const receipt = await stripe.transfers.createReversal(
            row.stripeTransferId!,
            { amount: op.amount, metadata },
            { idempotencyKey: `bs_affiliate_${op._id}` },
          );
          if (receipt.amount !== op.amount)
            throw new Error("Affiliate provider reversal amount mismatch.");
          confirmed = receipt.id;
        } else {
          const receipt = await stripe.transfers.create(
            {
              amount: op.amount,
              currency: row.currency,
              destination: row.affiliateAccountId,
              transfer_group: `bs_restore_${row._id}`,
              metadata,
            },
            { idempotencyKey: `bs_affiliate_${op._id}` },
          );
          if (receipt.amount !== op.amount || receipt.currency !== row.currency)
            throw new Error("Affiliate provider restoration amount mismatch.");
          confirmed = receipt.id;
        }
      }
      const confirmedTransferReversed =
        op.kind === "recovery"
          ? (await stripe.transfers.retrieve(row.stripeTransferId!))
              .amount_reversed
          : undefined;
      await runMutationOrThrow(
        ctx,
        componentRef(
          component,
          "affiliateRecovery/mutations/completeOperation",
        ),
        {
          operationId: op._id,
          state: "succeeded",
          receiptId: confirmed,
          confirmedTransferReversed,
        },
      );
      lastState = "succeeded";
    } catch (error) {
      const outcome = classifyRecoveryError(error);
      // This write deliberately occurs outside the provider/receipt transaction.
      // Unknown outcomes retain the reservation and block commission release.
      await runMutationOrThrow(
        ctx,
        componentRef(
          component,
          "affiliateRecovery/mutations/completeOperation",
        ),
        { operationId: op._id, ...outcome },
      );
      return outcome;
    }
    row = (await ctx.runQuery(
      componentRef(component, "affiliateRecovery/queries/getObligation"),
      { obligationId },
    )) as RecoveryObligation;
  }
  return { state: lastState };
}
export async function reconcileAffiliateCharge(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  sourceChargeId: string,
) {
  const rows = (await ctx.runQuery(
    componentRef(component, "affiliateRecovery/queries/chargeObligations"),
    { sourceChargeId },
  )) as RecoveryObligation[] | null;
  const results = [];
  for (const row of rows ?? [])
    if (
      typeof row._id === "string" &&
      typeof row.originalCommission === "number"
    )
      results.push(await reconcileObligation(stripe, component, ctx, row._id));
  return results;
}
