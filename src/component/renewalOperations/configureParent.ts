import type { QueryCtx } from "../_generated/server.js";
import { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import { equal } from "../../client/billing/renewalAggregate/shared.js";
import {
  originalRecord,
  currentReservation,
  eventChain,
  checkedInitialBasis,
  validateV2KnownAcknowledgement,
} from "./helpers.js";
import { configureConflict, jsonObject } from "./configureValidation.js";

type Reader = Pick<QueryCtx, "db">;
/** Parent linkage is checked DATA; host authorization and live custody remain separate. */
export async function validateConfigureParent(
  ctx: Reader,
  full: ReturnType<typeof canonicalJournalRecord>,
) {
  if (!("recordVersion" in full)) return null;
  const child = jsonObject(JSON.parse(full.json));
  if (child.stage !== "configure") return null;
  try {
    const link = jsonObject(child.parentAttachment);
    if (typeof link.operationId !== "string") configureConflict();
    const parentId = ctx.db.normalizeId("renewalOperations", link.operationId);
    if (!parentId) configureConflict();
    const row = await ctx.db.get("renewalOperations", parentId);
    if (!row || row.recordVersion !== 2) configureConflict();
    const parentFull = await originalRecord(ctx, row);
    const parent = jsonObject(JSON.parse(parentFull.json));
    if (parent.stage !== "attach") configureConflict();
    const reservation = await currentReservation(ctx, row, parentFull);
    if (!reservation || reservation.stage !== "attach") configureConflict();
    const basis = checkedInitialBasis(row, reservation.attemptId, reservation);
    if (!basis) configureConflict();
    const events = await eventChain(ctx, reservation);
    if (events.length !== 3) configureConflict();
    const known = await validateV2KnownAcknowledgement(
      ctx,
      row,
      parentFull,
      reservation,
      events,
    );
    if (!known) configureConflict();
    const source = jsonObject(child.configureRecord);
    const configuration = jsonObject(source.configuration);
    const rawReceipt = jsonObject(configuration.attachReceipt);
    const policy = jsonObject(child.timingPolicy);
    const parentPolicy = jsonObject(parent.timingPolicy);
    if (
      link.operationId !== row._id ||
      link.attemptId !== reservation.attemptId ||
      link.sourcePayloadId !== reservation.payloadId ||
      link.receiptBinding !== known.admitted.receiptBinding ||
      !equal(source.attachReceipt, JSON.parse(known.admitted.receiptJSON)) ||
      !equal(rawReceipt.attachRequest, parent.attachRequest) ||
      !equal(source.originalBundle, parent.originalBundle) ||
      !equal(child.account, parent.account) ||
      child.apiVersion !== parent.apiVersion ||
      policy.workEndWallMs !== parentPolicy.workEndWallMs ||
      policy.endWallMs !== parentPolicy.endWallMs ||
      policy.periodStart !== parentPolicy.periodStart ||
      policy.periodEnd !== parentPolicy.periodEnd
    )
      configureConflict();
    return { basisJSON: basis.basisJSON, parentOperationId: row._id };
  } catch {
    return configureConflict();
  }
}
