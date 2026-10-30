import { admitConfigureACK } from "../configure/output.js";
import { equal } from "../../../renewalAggregate/shared.js";
import type { RenewalConfigurationReceiptV2 } from "../../../renewalV2/index.js";
import type {
  ObservationRecord,
  RetainedConfigureAcknowledgement,
} from "./types.js";

/** Stateless whole relation only; the actor must establish actual returned-ACK custody first. */
export function admitRetainedConfigureAcknowledgement(
  record: ObservationRecord,
  retained: RetainedConfigureAcknowledgement,
  actualReceipt: RenewalConfigurationReceiptV2,
) {
  // Existing exact18/19 slot ledger binds the complete request/raw response/default presence.
  admitConfigureACK(record, retained.rawReceipt, actualReceipt);
  if (!equal(actualReceipt, retained.receipt))
    throw Error("OWNED_OBSERVATION_STOP");
  return retained.rawReceipt;
}
