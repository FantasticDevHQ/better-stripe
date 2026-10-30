import assert from "node:assert/strict";
import { deepFreeze } from "./configurePreflightControls.js";
import { declareConfigureWriteCase } from "./configureWriteDeclarations.js";
import { declareOptionalConfigureACK18 } from "./observationConfigureACKDeclarations.js";

export const configureACKLifecycleCases = [
  "L01-output-abort",
  "L02-receipt-ACK-fault",
  "L03-final-discard-abort",
  "L04-POST-pending",
  "L05-POST-unknown",
  "L06-receipt-ACK-retire",
  "L07-C6Failure-priority",
] as const;
export type ConfigureACKLifecycleCase =
  (typeof configureACKLifecycleCases)[number];
/** All choices and raw rows precede actual fixture constructors. */
export function declareConfigureACKLifecycle(
  controlCase: ConfigureACKLifecycleCase,
) {
  const allowed: readonly string[] = configureACKLifecycleCases;
  assert(allowed.includes(controlCase), "UNDECLARED_LIFECYCLE_CASE");
  const writerMode =
    controlCase === "L04-POST-pending"
      ? "pending-prior"
      : controlCase === "L05-POST-unknown"
        ? "post-reject"
        : "ack";
  const expectedOwner =
    controlCase === "L06-receipt-ACK-retire" ? "retired" : "live";
  const known = [
    "L01-output-abort",
    "L02-receipt-ACK-fault",
    "L03-final-discard-abort",
    "L06-receipt-ACK-retire",
  ].includes(controlCase);
  const recordCount =
    controlCase === "L01-output-abort"
      ? 2
      : controlCase === "L04-POST-pending" || controlCase === "L05-POST-unknown"
        ? 1
        : 3;
  return deepFreeze({
    controlCase,
    writerMode,
    expectedOwner,
    known,
    writer: declareConfigureWriteCase(writerMode),
    readonly: declareOptionalConfigureACK18(),
    expectedWriterAtRefusal: {
      records: recordCount,
      POST: 1,
      C9: known || controlCase === "L07-C6Failure-priority" ? 1 : 0,
    },
    candidateKind:
      controlCase === "L07-C6Failure-priority"
        ? "actual-returned-ACK"
        : known
          ? "actual-admission-DATA-never-returned"
          : "pure-oracle-DATA-only",
    invalidAPI: "2026-01-01.unsupported",
    expectedC6FailureReason: "invalid_attach_receipt_binding",
    faults: {
      output: "TEST_ABORT_AFTER_REAL_ACK_ADMISSION",
      discard: "TEST_ABORT_AFTER_REAL_DISCARD",
    },
    expectedUnknown: {
      status: "configure_unknown",
      reason:
        expectedOwner === "retired"
          ? "owner_closed_after_post"
          : "post_unverified",
      operationalAuthority: false,
    },
  } as const);
}
export type ConfigureACKLifecycleDeclaration = ReturnType<
  typeof declareConfigureACKLifecycle
>;
