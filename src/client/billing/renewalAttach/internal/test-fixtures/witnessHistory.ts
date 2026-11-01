import assert from "node:assert/strict";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { constructRenewalConfigurationReceiptV2 } from "../../../renewalV2/index.js";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { canonicalConfigure } from "../../../../../component/renewalOperations/configureJournal.fixtures.js";
import type { prepareWitnessObservation } from "./witnessObservation.js";

/** Real later component retention, not a runtime/public provider ACK. */
export async function retainLaterWitnessC9(
  h: Parameters<typeof prepareWitnessObservation>[0],
  state: Awaited<ReturnType<typeof prepareWitnessObservation>>,
  targetEndOffset = 0,
) {
  const refs = components.betterStripe.renewalOperations;
  const stage = state.full.configure;
  assert(stage.attempt && "initialBasis" in state.full.parent.operation);
  const basis = state.full.parent.operation.initialBasis;
  assert(basis);
  const record = JSON.parse(stage.operation.recordJSON);
  const reservation = stage.attempt.reservation;
  await h.ctx.runMutation(refs.mutations.bindInitialBasis, {
    operationId: state.operationId,
    attemptId: reservation.attemptId,
    policyJSON: canonicalConfigure(record.timingPolicy),
    basisJSON: basis.basisJSON,
  });
  const body = structuredClone(state.reads.schedule);
  body.current_phase = structuredClone(
    record.configureRecord.configuration.schedule.current_phase,
  );
  const phases = body.phases as Record<string, unknown>[];
  phases[1].end_date = Number(phases[1].end_date) + targetEndOffset;
  const transport = {
    status: 200,
    requestId: "req_controlled_later_witness_C9",
  };
  const rawReceipt = {
    configuration: record.configureRecord.configuration,
    actualDispatch: record.dispatch,
    providerSnapshot: body,
    transport,
  };
  const receipt = await constructRenewalConfigurationReceiptV2(rawReceipt);
  const request = record.configureRecord.request;
  const events = [
    { event: "dispatch", stage: "configure", request },
    { event: "response", stage: "configure", request, body, transport },
    { event: "receipt", stage: "configure", request, receipt },
  ];
  for (const [index, event] of events.entries()) {
    if (index === 2)
      await h.ctx.runMutation(refs.mutations.retainProviderAcknowledgement, {
        operationId: state.operationId,
        attemptId: reservation.attemptId,
        expectedSequence: 2,
        receiptJSON: canonicalConfigure(receipt),
      });
    const sequence = index === 0 ? 1 : index === 1 ? 2 : 3;
    const data = await canonicalJournalEvent(
      sequence,
      canonicalConfigure(event),
    );
    await h.ctx.runMutation(refs.mutations.appendStageEvent, {
      reservation,
      expectedSequence: index,
      event: { sequence, binding: data.binding, dataJSON: data.json },
    });
  }
  return { rawReceipt, receipt };
}
