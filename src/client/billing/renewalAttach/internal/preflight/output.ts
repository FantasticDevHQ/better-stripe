import { OWNER } from "../originalOwner.js";
import { need, freeze, materialize } from "../material/nodeKernel.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { capturePreflightOutput } from "./record.js";
import { expectedSlots } from "./relations.js";
import type {
  PreflightRecord,
  CurrentEvidence,
  PreflightOutput,
} from "./grammar.js";
import type {
  ProjectedRenewalConfigurationV2,
  RenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
export function releasePreflight(
  record: PreflightRecord,
  currentEvidence: CurrentEvidence,
  request: ProjectedRenewalConfigurationV2,
  originalC6: ProjectedRenewalConfigurationV2,
  ackC3: RenewalScheduleAttachmentReceiptV2,
): PreflightOutput {
  OWNER.check();
  need(
    equal(record.request, originalC6) &&
      equal(request, originalC6) &&
      equal(record.attachReceipt, ackC3),
  );
  const result = {
    status: "configure_preflight_consistent",
    originalRecord: record,
    currentEvidence,
    request,
    operationalAuthority: false,
  };
  const captured = capturePreflightOutput(result),
    expected = expectedSlots(originalC6, ackC3, true);
  for (const [path, value] of Object.entries(expected))
    need(captured.slots.get(path) === value);
  const output = freeze(materialize(captured.node));
  OWNER.check();
  return output as PreflightOutput;
}
