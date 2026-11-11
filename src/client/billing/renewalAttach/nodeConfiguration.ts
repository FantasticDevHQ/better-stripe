import { canonicalJournalRecord } from "../../../shared/renewalOperationJournal.js";
import { createClassActionOperationJournal } from "./internal/operationJournal.js";
import { consumeLiveAttachment } from "./liveAttachment.js";
import { captureAdmittedConfigurePreflight } from "./internal/producer/configurePreflight.js";
import { captureAdmittedConfigureWrite } from "./internal/producer/configureWrite.js";
import type { ConfigurationExecutor } from "../../renewalConfigurationRuntime.js";
import type { ConfigureRenewalScheduleResult } from "../../renewalConfigurationTypes.js";
import type { RenewalConfigurationReceiptV2 } from "../renewalV2/index.js";

export const configureRenewalSchedule: ConfigurationExecutor = async (
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
    throw Error("INVALID_RENEWAL_CONFIGURATION_OPTIONS");
  const { operationId, requestBinding, authorizationQuery } = options;
  const refuse = (reason: string): ConfigureRenewalScheduleResult => ({
    status: "not_dispatched",
    operationId,
    reason,
  });
  const conflict = (reason: string): ConfigureRenewalScheduleResult => ({
    status: "conflict",
    operationId,
    reason,
  });
  const key = Object.getOwnPropertyDescriptor(root, "_apiKey")?.value;
  if (typeof key !== "string" || !/^[rs]k_test_/.test(key))
    return refuse("test_mode_key_required");
  const journal = await createClassActionOperationJournal(root, {
    actualActionCtx: ctx,
    operationId,
  });
  const loaded = await journal.loadAuthorizedOperation();
  if (!loaded) return refuse("operation_not_found");
  const full = canonicalJournalRecord(loaded.recordJSON),
    record = JSON.parse(full.json);
  if (full.requestBinding !== requestBinding)
    return conflict("request_binding_mismatch");
  if (
    record.schemaVersion !== 2 ||
    record.stage !== "configure" ||
    record.profile !== "node-endive-configure-v1" ||
    record.apiVersion !== "2026-09-30.endive" ||
    record.account.livemode !== false ||
    record.configureRecord.configuration.executionProfile !==
      "node-endive-configure-v1"
  )
    return refuse("unsupported_execution_profile");
  if (
    (await ctx.runQuery(authorizationQuery, {
      capability: "renewal_configuration_v1",
      operationId,
      attachmentOperationId: record.parentAttachment.operationId,
      authorizationScope: full.authorizationScope,
      authorizationId: full.authorizationId,
      authorizationRevision: full.authorizationRevision,
      logicalOperationId: full.logicalOperationId,
      requestBinding,
      expected: record.configureRecord.configuration.preparation.expected,
    })) !== true
  )
    return refuse("not_authorized");
  if (loaded.revision !== 0) return conflict("attempt_already_reserved");
  const live = consumeLiveAttachment(
    root,
    record.parentAttachment.operationId,
    ctx,
  );
  if (!live) return refuse("live_attachment_required");
  const { core, basis } = live;
  const deadlineElapsed = () =>
    Date.now() >= basis.workEndWallMs ||
    process.hrtime.bigint() >= basis.workEndNs;
  let preflightCompleted = false;
  let attemptId: string | undefined;
  const uncertain = (
    status: "unknown" | "timeout",
    reason: string,
  ): ConfigureRenewalScheduleResult =>
    status === "timeout"
      ? {
          status,
          outcome: "unknown",
          operationId,
          attemptId: attemptId!,
          reason,
        }
      : { status, operationId, attemptId: attemptId!, reason };
  try {
    core.owner.check();
    const fresh = await journal.reserveFreshAttempt({
      expectedRevision: 0,
      stage: "configure",
      expectedRequestBinding: requestBinding,
      recordJSON: full.json,
    });
    if (fresh.result.disposition !== "acquired" || !fresh.call)
      return conflict("attempt_already_reserved");
    attemptId = fresh.result.reservation.attemptId;
    const token = await core.admitConfigure(fresh.call, journal);
    await captureAdmittedConfigurePreflight(token).invoke();
    preflightCompleted = true;
    const raw = await captureAdmittedConfigureWrite(token).invoke();
    const outcome = raw as {
      status: string;
      receipt?: RenewalConfigurationReceiptV2;
      reason?: string;
    };
    if (outcome.status === "configure_acknowledged" && outcome.receipt)
      return {
        status: "configure_acknowledged",
        operationId,
        attemptId,
        receipt: outcome.receipt,
      };
    if (outcome.status === "not_dispatched")
      return refuse(outcome.reason ?? "preconfigure_baseline_changed");
    if (deadlineElapsed())
      return uncertain("timeout", "original_deadline_exceeded");
    return uncertain("unknown", "configuration_not_acknowledged");
  } catch (error) {
    if (!attemptId) return refuse("original_window_expired");
    const failure =
      error instanceof Error
        ? Object.getOwnPropertyDescriptor(error, "failure")?.value
        : undefined;
    if (deadlineElapsed() || failure?.diagnostics?.code === "ETIMEDOUT")
      return uncertain("timeout", "original_deadline_exceeded");
    if (failure?.phase === "post" && failure.diagnostics?.statusCode === 409)
      return conflict("provider_conflict");
    if (failure?.phase === "read") return refuse("provider_read_failed");
    if (!preflightCompleted)
      return refuse("preconfigure_material_unsupported_or_changed");
    return uncertain("unknown", "configuration_not_acknowledged");
  } finally {
    core.owner.retire();
  }
};
