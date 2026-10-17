import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { advanceObservationGeneration } from "./generations.js";
import { invalidate, legOwnership } from "./settlementHelpers.js";
import {
  transferFingerprint,
  transferIdentity,
  transferProducerScope,
} from "./transferHelpers.js";
/** Record references only; never reject or rewrite a financial source to repair diagnostics. */
export async function observeTransfer(
  ctx: MutationCtx,
  row: Doc<"transfers">,
  options: { preserveUnregisteredOwnership?: boolean } = {},
) {
  const markers = await ctx.db
    .query("financialTransferObservations")
    .withIndex("by_transfer_id", (q) => q.eq("transferId", row._id))
    .take(2);
  if (markers.length > 1) {
    await advanceObservationGeneration(ctx, transferProducerScope);
    return;
  }
  const prior = markers[0];
  const identity = await transferFingerprint(transferIdentity(row));
  const { totalsRecorded, ...financial } = row;
  void totalsRecorded;
  const observedFingerprint = await transferFingerprint(financial);
  const ownership =
    options.preserveUnregisteredOwnership && prior && !prior.registrationId
      ? {
          registrationId: prior.registrationId,
          userId: prior.userId,
          orgId: prior.orgId,
          ownershipStatus: prior.ownershipStatus,
        }
      : await legOwnership(
          ctx,
          prior?.bucketKey ?? row.destinationAccountId,
          prior,
        );
  const ownershipFingerprint = await transferFingerprint(ownership);
  const sourceRows = await ctx.db
    .query("transfers")
    .withIndex("by_stripe_transfer_id", (q) =>
      q.eq("stripeTransferId", row.stripeTransferId),
    )
    .take(2);
  const isContradictory =
    sourceRows.length !== 1 ||
    sourceRows[0]?._id !== row._id ||
    prior?.isContradictory === true ||
    (prior !== undefined && prior.fingerprint !== identity);
  if (
    prior?.observedFingerprint === observedFingerprint &&
    prior.ownershipFingerprint === ownershipFingerprint &&
    prior.isContradictory === isContradictory
  )
    return;
  const generation = (prior?.generation ?? 0) + 1;
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    (prior && prior.generation < 1)
  ) {
    if (prior)
      await ctx.db.patch("financialTransferObservations", prior._id, {
        generation: 0,
        isContradictory: true,
      });
    await advanceObservationGeneration(ctx, transferProducerScope);
    return;
  }
  const fields = {
    transferId: row._id,
    stripeTransferId: prior?.stripeTransferId ?? row.stripeTransferId,
    sourceChargeId: prior ? prior.sourceChargeId : row.sourceChargeId,
    sourceInvoiceId: prior ? prior.sourceInvoiceId : row.sourceInvoiceId,
    bucketKey: prior?.bucketKey ?? row.destinationAccountId,
    role: prior ? prior.role : row.role,
    ...ownership,
    producer: "transfer_fact" as const,
    producerVersion: 1 as const,
    fingerprint: prior?.fingerprint ?? identity,
    observedFingerprint,
    ownershipFingerprint,
    generation,
    isContradictory,
  };
  if (prior)
    await ctx.db.patch("financialTransferObservations", prior._id, fields);
  else await ctx.db.insert("financialTransferObservations", fields);
  await invalidate(ctx, [
    ...(prior ? [prior] : []),
    fields,
    { bucketKey: row.destinationAccountId },
  ]);
  await advanceObservationGeneration(ctx, transferProducerScope);
}
