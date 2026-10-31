import {
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
} from "../c10/eventCapture.js";
import { reconstructConfigurationV2 } from "../../../renewalV2/index.js";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { closed } from "../operations/types.js";
import {
  consumeConfigureLineage,
  checkConfigureLineage,
  finishConfigureLineage,
  closeConfigureLineage,
} from "./configureLineage.js";
import {
  checkOperationLoad,
  checkEmptyConfigureHistory,
  configureBasisDescriptor,
  captureParentHistory,
  checkParentAcknowledgement,
  matchConfigureDATA,
  requireConfigure,
  object,
  text,
} from "./configureJournalData.js";

/** Bind actual child custody to the live parent's exact basis; no execution profile. */
export async function captureConfigureAdmission(
  parentToken: object,
  call: unknown,
  journal: unknown,
  arity: number,
) {
  const token = consumeConfigureLineage(parentToken, call, journal, arity);
  const state = checkConfigureLineage(token);
  const owned = ownedAwaitForInitialLineage(parentToken);
  async function checked<T>(work: () => T | PromiseLike<T>): Promise<T> {
    checkConfigureLineage(token);
    const result = await owned(work);
    checkConfigureLineage(token);
    return result;
  }
  async function parentFrontier() {
    checkOperationLoad(
      await checked(() => state.parent.journal.loadAuthorizedOperation()),
      state.parentReservation,
      state.parent.basisJSON,
    );
    const events = captureParentHistory(
      await checked(() =>
        state.parent.journal.readAttempt({
          attemptId: state.parentReservation.attemptId,
        }),
      ),
      state.parentReservation,
    );
    for (const descriptor of events) {
      const raw: unknown = await checked(() =>
        state.parent.journal.readStageEvent({
          attemptId: state.parentReservation.attemptId,
          sequence: descriptor.sequence,
        }),
      );
      const event = closed(raw, [...Object.keys(descriptor), "dataJSON"]);
      const dataJSON = text(event.dataJSON);
      const parsed: unknown = JSON.parse(dataJSON);
      const receipt = object(state.acknowledgement.receipt);
      // Typed privacy/bounds capture and complete C3 equality precede hashing.
      if (descriptor.sequence === 1) {
        captureAttachDispatch(parsed);
        matchConfigureDATA(parsed, {
          event: "dispatch",
          stage: "attach",
          request: receipt.request,
        });
      } else if (descriptor.sequence === 2) {
        captureAttachResponse(parsed);
        const response = object(parsed);
        matchConfigureDATA(parsed, {
          event: "response",
          stage: "attach",
          request: receipt.request,
          body: receipt.providerSnapshot,
          status: response.status,
        });
      } else {
        captureAttachReceipt(parsed);
        matchConfigureDATA(parsed, {
          event: "receipt",
          stage: "attach",
          request: receipt.request,
          receipt: state.acknowledgement.receipt,
        });
      }
      const canonical = await checked(() =>
        canonicalJournalEvent(descriptor.sequence, dataJSON),
      );
      requireConfigure(
        canonical.json === dataJSON && canonical.binding === descriptor.binding,
      );
      matchConfigureDATA(raw, { ...descriptor, dataJSON });
    }
    checkParentAcknowledgement(
      await checked(() => state.parent.journal.readProviderAcknowledgement()),
      state.parentReservation,
      events,
      state.receiptJSON,
      state.receiptBinding,
    );
  }
  async function childFrontier(allowUnbound: boolean) {
    checkOperationLoad(
      await checked(() => state.consumed.journal.loadAuthorizedOperation()),
      state.reservation,
      state.parent.basisJSON,
      allowUnbound,
    );
    matchConfigureDATA(
      await checked(() => state.consumed.journal.readProviderAcknowledgement()),
      null,
    );
    // Best-effort frontier fence, not an atomic lock. No later journal await.
    return checked(() =>
      state.consumed.journal.readAttempt({
        attemptId: state.reservation.attemptId,
      }),
    );
  }
  try {
    const rebuilt = await checked(() =>
      reconstructConfigurationV2(state.configuration),
    );
    requireConfigure(rebuilt.material && "requestIdentity" in rebuilt.result);
    const request = rebuilt.result;
    matchConfigureDATA(state.source.request, request);
    matchConfigureDATA(state.source.attachReceipt, rebuilt.material.receipt);
    const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
      request;
    matchConfigureDATA(state.original.dispatch, {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    });
    requireConfigure(
      state.reservation.requestBinding === request.requestIdentity.binding &&
        state.reservation.key === key &&
        state.reservation.apiVersion === apiVersion &&
        state.reservation.firstDispatchedAt === firstDispatchedAt,
    );
    await parentFrontier();
    checkEmptyConfigureHistory(await childFrontier(true), state.reservation);
    const reply: unknown = await checked(() =>
      state.consumed.journal.bindInitialBasis({
        attemptId: state.reservation.attemptId,
        policyJSON: state.reservation.timingPolicyJSON,
        basisJSON: state.parent.basisJSON,
      }),
    );
    matchConfigureDATA(reply, {
      status: "bound",
      operationId: state.reservation.operationId,
      initialBasis: configureBasisDescriptor(
        state.reservation,
        state.parent.basisJSON,
      ),
    });
    await parentFrontier();
    checkEmptyConfigureHistory(await childFrontier(false), state.reservation);
    return finishConfigureLineage(token);
  } catch (error) {
    closeConfigureLineage(token);
    throw error;
  }
}
