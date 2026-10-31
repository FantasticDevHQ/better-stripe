import { readOriginalConfigureWriteTransport } from "../configure/transport.js";
import { need } from "../configure/request.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";
import type { CurrentEvidence } from "../preflight/grammar.js";
import type { checkConfigureRetention } from "./configureJournalData.js";
import type {
  ConstructRenewalConfigurationReceiptV2Options,
  RenewalConfigurationReceiptV2,
} from "../../../renewalV2/index.js";

type Pair = ReturnType<typeof readOriginalConfigureWriteTransport>;
export type ConfigureCompletion = Readonly<{
  output: unknown;
  receipt: unknown;
  rawReceipt: unknown;
  acknowledgement: Pair["preflight"]["acknowledgement"];
  originalEntry: unknown;
  configureEntry: unknown;
  coversConfigure: unknown;
  operationalAuthority: false;
}>;
export type ConfigureAttempt = {
  pair: Pair;
  started: boolean;
  settled: boolean;
  recoveryReserved: boolean;
  freshEvidence: CurrentEvidence | null;
  recoveryEvidence: CurrentEvidence | null;
  response: Readonly<{
    body: Record<string, unknown>;
    transport: ConstructRenewalConfigurationReceiptV2Options["transport"];
  }> | null;
  receipt: RenewalConfigurationReceiptV2 | null;
  rawReceipt: ConstructRenewalConfigurationReceiptV2Options | null;
  retention: ReturnType<typeof checkConfigureRetention> | null;
  completion: { view: ConfigureCompletion; guard: () => void } | null;
};
const attempts = new WeakMap<object, ConfigureAttempt>();
const recoveries = new WeakMap<
  object,
  { token: object; attempt: ConfigureAttempt }
>();
/** Only the original, internally constructed pair can create this private attempt. */
export function createConfigureWriteAttempt(token: object, pair: Pair) {
  need(arguments.length === 2 && !attempts.has(token));
  need(readOriginalConfigureWriteTransport(token) === pair);
  const attempt: ConfigureAttempt = {
    pair,
    started: false,
    settled: false,
    recoveryReserved: false,
    freshEvidence: null,
    recoveryEvidence: null,
    response: null,
    receipt: null,
    rawReceipt: null,
    retention: null,
    completion: null,
  };
  attempts.set(token, attempt);
  return attempt;
}
export function readOriginalConfigureAttempt(token: object) {
  need(arguments.length === 1);
  const attempt = attempts.get(token);
  need(attempt);
  need(readOriginalConfigureWriteTransport(token) === attempt.pair);
  return attempt;
}
/** Reserve original runtime custody synchronously, before any recovery await. */
export function takeOriginalConfigureRecovery(token: object, arity: number) {
  const attempt = attempts.get(token);
  need(attempt && !attempt.recoveryReserved);
  attempt.recoveryReserved = true;
  need(arity === 1);
  need(readOriginalConfigureAttempt(token) === attempt);
  need(
    attempt.started &&
      attempt.settled &&
      attempt.freshEvidence !== null &&
      attempt.completion === null &&
      journalWorkForConfigureLineage(token).idle(),
  );
  const disposition = attempt.pair.transport.postDisposition();
  need(disposition !== "NOT_STARTED" && disposition !== "PENDING");
  need(
    attempt.response !== null ||
      attempt.receipt !== null ||
      disposition === "REJECTED" ||
      disposition === "FULFILLED_UNVERIFIED",
  );
  const recovery = Object.freeze({ operationalAuthority: false as const });
  recoveries.set(recovery, { token, attempt });
  return recovery;
}
export function readConfigureRecoveryAuthority(recovery: object) {
  need(arguments.length === 1);
  const current = recoveries.get(recovery);
  need(current);
  need(
    readOriginalConfigureAttempt(current.token) === current.attempt &&
      current.attempt.recoveryReserved &&
      current.attempt.settled,
  );
  return current;
}
/** DATA only. Neither this view nor copied receipts can register recovery or ACK. */
export function readAdmittedConfigureWriteAttempt(token: object) {
  need(arguments.length === 1);
  const attempt = readOriginalConfigureAttempt(token);
  const view = Object.freeze({
    postDisposition: attempt.pair.transport.postDisposition(),
    receiptKnown: attempt.receipt !== null,
    receipt: attempt.receipt,
    rawReceipt: attempt.rawReceipt,
    returned: attempt.completion !== null,
    operationalAuthority: false as const,
  });
  attempt.pair.guard();
  return view;
}
