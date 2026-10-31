import type { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import type { Reservation, CheckedEvents } from "./validationTypes.js";
import {
  validateAttachAcknowledgement,
  validateAttachReceiptEventDATA,
} from "./attachValidation.js";
import {
  validateConfigureAcknowledgement,
  validateConfigureReceiptEventDATA,
} from "./configureAcknowledgement.js";

export async function validateStageAcknowledgement(
  full: ReturnType<typeof canonicalJournalRecord>,
  reservation: Reservation,
  events: CheckedEvents,
  receiptJSON: string,
) {
  if (reservation.stage === "configure" && "recordVersion" in reservation)
    return {
      ...(await validateConfigureAcknowledgement(
        full,
        reservation,
        events,
        receiptJSON,
      )),
      stage: "configure" as const,
    };
  return {
    ...(await validateAttachAcknowledgement(
      full,
      reservation,
      events,
      receiptJSON,
    )),
    stage: "attach" as const,
  };
}
export function validateStageReceiptEventDATA(
  raw: string,
  admitted: Awaited<ReturnType<typeof validateStageAcknowledgement>>,
) {
  if (admitted.stage === "configure")
    validateConfigureReceiptEventDATA(raw, admitted.receipt);
  else validateAttachReceiptEventDATA(raw, admitted.receipt);
}
