import { consumeInitialClassReservation } from "../operationJournal.js";
import { readInitialLineage } from "./lineageAuthority.js";
import { readAttachAcknowledgementForLineage } from "./attachAcknowledgement.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { journalWorkForInitialLineage } from "./journalWorkFactory.js";
import { checkConfigureJournalAssociation } from "./classOwnedActionRoot.js";
import { captureConfigureSource } from "../c10/eventCapture.js";
import { canonicalInitialBasis } from "../../../../../shared/renewalOperationJournal.js";
import { closed } from "../operations/types.js";
import {
  captureOperationalReservation,
  matchConfigureDATA,
  requireConfigure,
  object,
  text,
} from "./configureJournalData.js";

type Parent = ReturnType<typeof readInitialLineage>;
export type ConfigureAdmission = Readonly<{
  owner: ReturnType<typeof ownerForInitialLineage>;
  basisJSON: string;
  operationalAuthority: false;
}>;
type State = {
  phase: "pending" | "ready" | "failed";
  parentToken: object;
  parent: Parent;
  owner: ConfigureAdmission["owner"];
  acknowledgement: ReturnType<typeof readAttachAcknowledgementForLineage>;
  consumed: ReturnType<typeof consumeInitialClassReservation>;
  reservation: ReturnType<typeof captureOperationalReservation>;
  parentReservation: ReturnType<typeof captureOperationalReservation>;
  configuration: ReturnType<typeof captureConfigureSource>;
  source: Record<string, unknown>;
  original: Record<string, unknown>;
  receiptJSON: string;
  receiptBinding: string;
};
const lineages = new WeakMap<object, State>();

/** Original fresh CAS custody is spent before admission reflection or awaits. */
export function consumeConfigureLineage(
  parentToken: object,
  call: unknown,
  journal: unknown,
  arity: number,
): ConfigureAdmission {
  const consumed = consumeInitialClassReservation(call, journal);
  requireConfigure(arity === 2);
  const parent = readInitialLineage(parentToken);
  const acknowledgement = readAttachAcknowledgementForLineage(parentToken);
  const owner = ownerForInitialLineage(parentToken);
  owner.check();
  checkConfigureJournalAssociation(parent.binding, consumed.binding);
  const reservation = captureOperationalReservation(
    consumed.reservation,
    "configure",
  );
  const parentReservation = captureOperationalReservation(
    parent.reservation,
    "attach",
  );
  const original = object(JSON.parse(reservation.recordJSON));
  const parentOriginal = object(JSON.parse(parentReservation.recordJSON));
  const source = closed(original.configureRecord, [
    "configuration",
    "request",
    "attachReceipt",
    "originalBundle",
  ]);
  const configuration = captureConfigureSource(source.configuration);
  matchConfigureDATA(source.configuration, configuration);
  const receipt = object(acknowledgement.receipt);
  const receiptJSON = JSON.stringify(acknowledgement.receipt);
  const receiptBinding = text(receipt.binding);
  matchConfigureDATA(original.parentAttachment, {
    operationId: parentReservation.operationId,
    attemptId: parentReservation.attemptId,
    sourcePayloadId: parentReservation.payloadId,
    receiptBinding,
  });
  matchConfigureDATA(source.attachReceipt, acknowledgement.receipt);
  matchConfigureDATA(
    configuration.attachReceipt.attachRequest,
    parentOriginal.attachRequest,
  );
  matchConfigureDATA(source.originalBundle, parentOriginal.originalBundle);
  matchConfigureDATA(original.account, parentOriginal.account);
  requireConfigure(original.apiVersion === parentOriginal.apiVersion);
  const policy = object(JSON.parse(reservation.timingPolicyJSON));
  const parentPolicy = object(JSON.parse(parentReservation.timingPolicyJSON));
  for (const key of ["workEndWallMs", "endWallMs", "periodStart", "periodEnd"])
    requireConfigure(policy[key] === parentPolicy[key]);
  const basis = canonicalInitialBasis(
    reservation.timingPolicyJSON,
    parent.basisJSON,
  );
  requireConfigure(basis.basisJSON === parent.basisJSON);
  const token = Object.freeze({
    owner,
    basisJSON: parent.basisJSON,
    operationalAuthority: false as const,
  });
  lineages.set(token, {
    phase: "pending",
    parentToken,
    parent,
    owner,
    acknowledgement,
    consumed,
    reservation,
    parentReservation,
    configuration,
    source,
    original,
    receiptJSON,
    receiptBinding,
  });
  checkConfigureLineage(token);
  return token;
}
/** Identity checks do not select a client, create an Owner or capture an origin. */
export function checkConfigureLineage(token: object) {
  const state = lineages.get(token);
  requireConfigure(state && state.phase !== "failed");
  requireConfigure(readInitialLineage(state.parentToken) === state.parent);
  state.owner.check();
  checkConfigureJournalAssociation(
    state.parent.binding,
    state.consumed.binding,
  );
  const actual = readAttachAcknowledgementForLineage(state.parentToken);
  requireConfigure(
    actual === state.acknowledgement &&
      actual.receipt === state.acknowledgement.receipt &&
      actual.output === state.acknowledgement.output,
  );
  requireConfigure(journalWorkForInitialLineage(state.parentToken).idle());
  return state;
}
export function finishConfigureLineage(
  token: ConfigureAdmission,
): ConfigureAdmission {
  const state = checkConfigureLineage(token);
  requireConfigure(state.phase === "pending");
  state.phase = "ready";
  return token;
}
export function closeConfigureLineage(token: object): void {
  const state = lineages.get(token);
  if (state) state.phase = "failed";
}
/** Trusted private consumers can only read a fully admitted original token. */
export function readConfigureLineage(token: object) {
  const state = checkConfigureLineage(token);
  requireConfigure(state.phase === "ready");
  return Object.freeze({
    parentToken: state.parentToken,
    owner: state.owner,
    parent: state.parent,
    reservation: state.reservation,
    originalReservation: state.consumed.reservation,
    journal: state.consumed.journal,
    configuration: state.configuration,
  });
}
