import { closed, freeze } from "../c10/ownData.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import { readCheckedJournalActionRPC } from "../producer/classOwnedActionRoot.js";
import { readObservationInvocation } from "./invocation.js";
import {
  captureReaderQueryDATA,
  readerText as text,
} from "./readerAuthorization.js";
import {
  createWitnessAuthorization,
  witnessRPC,
  witnessAddress,
  witnessProfileGuard,
  type WitnessMode,
  type WitnessProfile,
} from "./witnessAuthorization.js";
import {
  captureWitnessPayload,
  inspectWitnessPayload,
  checkedWitnessDescriptor,
  checkWitnessC7,
  type InspectedWitness,
} from "./witnessData.js";
import { inspectHistoricalMaterialEvidenceV1 } from "../../../renewalObservation/evidence-material.js";
import {
  witnessNeed as need,
  type WitnessIdentity,
} from "../../../../../shared/renewalWitness.js";
import type { ObservationReads } from "./types.js";
import type { InvoiceContextV1 } from "../../../renewalObservation/evidence-v1-types.js";

/** Actor-private protocol. Caller DATA cannot register a token, grant or returned ACK. */
export function createWitnessOperation(
  token: object,
  profile: WitnessProfile,
  mode: WitnessMode,
  identity: WitnessIdentity,
  transportGuard: () => void,
) {
  const state = readObservationInvocation(token),
    rpc = readCheckedJournalActionRPC(state.binding);
  const refs = rpc.component.renewalWitnesses;
  const retain = refs.mutations.retainAuthorizedWitness,
    read = refs.queries.readAuthorizedWitness;
  const addresses = [witnessAddress(retain), witnessAddress(read)];
  let authorization: ReturnType<typeof createWitnessAuthorization> | null =
    null;
  let stored: InspectedWitness | null = null;
  let descriptor: ReturnType<typeof checkedWitnessDescriptor> | null = null;
  let used = false;
  function guard() {
    state.guard();
    transportGuard();
    witnessProfileGuard(profile, mode);
    need(
      readCheckedJournalActionRPC(state.binding) === rpc &&
        profile.freshProfile.historyEntry === state.historyEntry,
    );
    const current = rpc.component.renewalWitnesses;
    need(
      witnessAddress(current.mutations.retainAuthorizedWitness) ===
        addresses[0] &&
        witnessAddress(current.queries.readAuthorizedWitness) === addresses[1],
    );
    authorization?.guard();
  }
  async function fullRead() {
    const raw: unknown = await witnessRPC(
      state,
      () => rpc.runQuery.call(rpc.receiver, read, { identity }),
      guard,
    );
    const reply = closed(captureReaderQueryDATA(raw), [
      "descriptor",
      "payloadJSON",
    ]);
    return {
      descriptor: reply.descriptor,
      payloadJSON: text(reply.payloadJSON, 500000),
    };
  }
  return Object.freeze({
    guard,
    async retain(
      reads: ObservationReads,
      invoiceContext: InvoiceContextV1 | null,
    ) {
      need(mode === "retain" && !used);
      used = true;
      guard();
      const payloadJSON = captureWitnessPayload(
        state,
        identity,
        reads,
        invoiceContext,
      );
      const admitted = await state.owned(
        () => inspectWitnessPayload(payloadJSON),
        guard,
      );
      checkWitnessC7(admitted.payload, state);
      authorization = createWitnessAuthorization(
        state,
        profile,
        mode,
        identity,
        admitted.scope,
      );
      await authorization.authorize();
      guard();
      const raw: unknown = await witnessRPC(
        state,
        () =>
          rpc.runMutation.call(rpc.receiver, retain, { identity, payloadJSON }),
        guard,
      );
      const reply = captureReaderQueryDATA(raw);
      if (
        reply &&
        typeof reply === "object" &&
        Reflect.get(reply, "status") === "conflict"
      ) {
        matchConfigureDATA(reply, {
          status: "conflict",
          reason: "identity_changed",
        });
        return freeze({
          status: "conflict" as const,
          reason: "identity_changed" as const,
        });
      }
      const result = closed(reply, ["status", "descriptor"]);
      need(result.status === "retained");
      const retained = checkedWitnessDescriptor(result.descriptor, admitted);
      const readback = await fullRead();
      need(readback.payloadJSON === payloadJSON);
      matchConfigureDATA(
        checkedWitnessDescriptor(readback.descriptor, admitted),
        retained,
      );
      guard();
      return freeze({ status: "retained" as const, descriptor: retained });
    },
    async load() {
      need(mode === "read" && !used);
      used = true;
      guard();
      authorization = createWitnessAuthorization(
        state,
        profile,
        mode,
        identity,
        null,
      );
      const grant = await authorization.authorize();
      guard();
      const reply = await fullRead();
      const admitted = await state.owned(
        () => inspectWitnessPayload(reply.payloadJSON),
        guard,
      );
      matchConfigureDATA(admitted.payload.identity, identity);
      checkWitnessC7(admitted.payload, state);
      matchConfigureDATA(admitted.scope, grant.scope);
      const checked = checkedWitnessDescriptor(reply.descriptor, admitted);
      need(
        checked.witnessRowId === grant.witnessRowId &&
          checked.payloadBinding === grant.payloadBinding,
      );
      stored = admitted;
      descriptor = checked;
      guard();
    },
    async historicalEvidence() {
      need(mode === "read" && stored && descriptor);
      guard();
      const input = stored.historicalInput;
      const material = await state.owned(
        () => inspectHistoricalMaterialEvidenceV1(input),
        guard,
      );
      return { identity: stored.identity, material };
    },
    descriptor() {
      need(mode === "read" && descriptor);
      guard();
      return descriptor;
    },
    async finalize() {
      need(authorization);
      guard();
      await authorization.authorize();
      guard();
    },
  });
}
