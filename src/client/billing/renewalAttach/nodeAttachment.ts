import { retainLiveAttachment } from "./liveAttachment.js";
import { canonicalJournalRecord } from "../../../shared/renewalOperationJournal.js";
import { createClassActionOperationJournal } from "./internal/operationJournal.js";
import { capturePublicInitialInvocationCore } from "./internal/producer/invocationProducer.js";
import {
  NODE_ATTACHMENT_PROFILE,
  ATTACHMENT_API_VERSION,
  ATTACHMENT_WORK_MS,
  ATTACHMENT_END_MS,
} from "./attachmentProfile.js";
import type { AttachmentExecutor } from "../../renewalAttachmentRuntime.js";
import type {
  RenewalAttachmentAuthorization,
  AttachRenewalScheduleResult,
} from "../../renewalAttachmentTypes.js";
import type { RenewalScheduleAttachmentReceiptV2 } from "../renewalV2/index.js";

/** Host authorization and immutable original reservation precede every provider read. */
export const attachRenewalSchedule: AttachmentExecutor = async (
  root,
  ctx,
  options,
) => {
  if (
    !options ||
    typeof options.operationId !== "string" ||
    !options.operationId.trim() ||
    typeof options.requestBinding !== "string" ||
    !options.requestBinding.trim() ||
    !options.authorizationQuery
  )
    throw Error("INVALID_RENEWAL_ATTACHMENT_OPTIONS");
  const { operationId, requestBinding, authorizationQuery } = options;
  const key = Object.getOwnPropertyDescriptor(root, "_apiKey")?.value;
  if (typeof key !== "string" || !/^[rs]k_test_/.test(key))
    return {
      status: "not_dispatched",
      operationId,
      reason: "test_mode_key_required",
    };
  const journal = await createClassActionOperationJournal(root, {
    actualActionCtx: ctx,
    operationId,
  });
  const loaded = await journal.loadAuthorizedOperation();
  const refuse = (reason: string): AttachRenewalScheduleResult => ({
    status: "not_dispatched",
    operationId,
    reason,
  });
  const conflict = (reason: string): AttachRenewalScheduleResult => ({
    status: "conflict",
    operationId,
    reason,
  });
  if (!loaded) return refuse("operation_not_found");
  const full = canonicalJournalRecord(loaded.recordJSON);
  if (full.requestBinding !== requestBinding)
    return conflict("request_binding_mismatch");
  const record = JSON.parse(full.json);
  if (
    record.schemaVersion !== 2 ||
    record.stage !== "attach" ||
    record.profile !== NODE_ATTACHMENT_PROFILE ||
    record.account.livemode !== false ||
    record.apiVersion !== ATTACHMENT_API_VERSION ||
    record.timingPolicy.workEndWallMs >
      record.timingPolicy.firstDispatchedAt * 1000 + ATTACHMENT_WORK_MS ||
    record.timingPolicy.endWallMs >
      record.timingPolicy.firstDispatchedAt * 1000 + ATTACHMENT_END_MS
  )
    return refuse("unsupported_execution_profile");
  const authorization: RenewalAttachmentAuthorization = {
    capability: "renewal_attachment_v1",
    operationId,
    authorizationScope: full.authorizationScope,
    authorizationId: full.authorizationId,
    authorizationRevision: full.authorizationRevision,
    logicalOperationId: full.logicalOperationId,
    requestBinding,
    expected: record.attachRequest.preparation.expected,
  };
  if ((await ctx.runQuery(authorizationQuery, authorization)) !== true)
    return refuse("not_authorized");
  if (loaded.revision !== 0) return conflict("attempt_already_reserved");
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(now) ||
    now >= record.timingPolicy.workEndWallMs ||
    now >= record.timingPolicy.endWallMs ||
    seconds < record.timingPolicy.firstDispatchedAt ||
    seconds - record.timingPolicy.firstDispatchedAt >= 86400 ||
    seconds < record.timingPolicy.periodStart ||
    seconds >= record.timingPolicy.periodEnd
  )
    return refuse("original_window_expired");
  const fresh = await journal.reserveFreshAttempt({
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: requestBinding,
    recordJSON: full.json,
  });
  if (fresh.result.disposition !== "acquired" || !fresh.call)
    return conflict("attempt_already_reserved");
  const attemptId = fresh.result.reservation.attemptId;
  let core:
    Awaited<ReturnType<typeof capturePublicInitialInvocationCore>> | undefined;
  let retainedLive = false;
  let originalWorkEndNs: bigint | undefined;
  const deadlineElapsed = () =>
    Date.now() >= record.timingPolicy.workEndWallMs ||
    (originalWorkEndNs !== undefined &&
      process.hrtime.bigint() >= originalWorkEndNs);
  const timeout = (): AttachRenewalScheduleResult => ({
    status: "timeout",
    outcome: "unknown",
    operationId,
    attemptId,
    reason: "original_deadline_exceeded",
  });
  try {
    core = await capturePublicInitialInvocationCore(
      fresh.call,
      journal,
      (basis) => {
        originalWorkEndNs = basis.workEndNs;
      },
    );
    const retained = await core.material.retained();
    if (retained.status !== "classified")
      return refuse("retained_material_unsupported");
    const raw = await core.initialAttach().invoke();
    if (!raw || typeof raw !== "object")
      throw Error("INVALID_ATTACHMENT_OUTCOME");
    const outcome = raw as Record<string, unknown>;
    if (outcome.status === "attach_acknowledged" && "receipt" in outcome) {
      retainLiveAttachment(
        root,
        operationId,
        ctx,
        core,
        record.timingPolicy.workEndWallMs,
      );
      retainedLive = true;
      return {
        status: "attached_incomplete",
        operationId,
        attemptId,
        receipt: outcome.receipt as RenewalScheduleAttachmentReceiptV2,
      };
    }
    if (deadlineElapsed()) return timeout();
    if (outcome.status === "not_dispatched" && "reason" in outcome)
      return refuse(String(outcome.reason));
    return {
      status: "unknown",
      operationId,
      attemptId,
      reason: "provider_response_unverified",
    };
  } catch (error) {
    const failure =
      error instanceof Error
        ? Object.getOwnPropertyDescriptor(error, "failure")?.value
        : undefined;
    if (deadlineElapsed() || failure?.diagnostics?.code === "ETIMEDOUT")
      return timeout();
    if (failure?.phase === "read") return refuse("provider_read_failed");
    if (failure?.phase === "post" && failure.diagnostics?.statusCode === 409)
      return conflict("provider_conflict");
    return {
      status: "unknown",
      operationId,
      attemptId,
      reason: "attachment_not_acknowledged",
    };
  } finally {
    if (!retainedLive) core?.owner.retire();
  }
};
