import {
  createConfigureWriteAttempt,
  type ConfigureCompletion,
} from "./configureAttemptAuthority.js";
export { readAdmittedConfigureAcknowledgement } from "./configureAcknowledgement.js";
export { readAdmittedConfigureWriteAttempt } from "./configureAttemptAuthority.js";
import { freeze } from "../material/nodeKernel.js";
import { closed as closedFields } from "../operations/types.js";
import { readConfigureLineage } from "./configureLineage.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { createAdmittedConfigureWriteTransport } from "../configure/transport.js";
import { createSelectedRawAcquisition } from "../acquisition/ownedAcquisition.js";
import { createAdmittedConfigureEventCompiler } from "../c10/configureEvents.js";
import {
  assertConfigurePreflightFrontier,
  assertConfigureWriteFrontier,
} from "./configureFrontier.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";
import { checkConfigureRetention } from "./configureJournalData.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalScheduleAttachmentReceiptV2,
  constructRenewalConfigurationReceiptV2,
} from "../../../renewalV2/index.js";
import {
  verifyPreflightRecordDATA,
  verifyCurrentPreflightDATA,
} from "../preflight/relations.js";
import { releasePreflightDATA } from "../preflight/output.js";
import {
  admitConfigureACK,
  admitConfigureFailure,
  configureControl,
} from "../configure/output.js";
import { need, seven, stop } from "../configure/request.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import type { Bundle } from "../material/capture.js";
import type { PreflightRecord } from "../preflight/grammar.js";

function matchesCurrentBundle(
  value: unknown,
  record: PreflightRecord,
): value is Bundle {
  return equal(value, {
    ...record.originalBundle,
    wireSubscription: record.configuration.freshSubscription,
  });
}
type Pair = ReturnType<typeof createAdmittedConfigureWriteTransport>;
/** One fixed initial configure attempt. No replay, caller frame or output registration. */
export function captureAdmittedConfigureWrite(token: object) {
  const pair = createAdmittedConfigureWriteTransport(token);
  need(arguments.length === 1);
  const attempt = createConfigureWriteAttempt(token, pair);
  const lineage = readConfigureLineage(token),
    owned = ownedAwaitForInitialLineage(lineage.parentToken);
  const compiler = createAdmittedConfigureEventCompiler(token),
    work = journalWorkForConfigureLineage(token);
  let used = false,
    closed = false,
    receiptKnown = false;
  function guard() {
    need(!closed);
    pair.guard();
  }
  async function checked<T>(call: () => T | PromiseLike<T>) {
    guard();
    const result = await owned(call);
    guard();
    return result;
  }
  function providerFailure(
    fact: NonNullable<ReturnType<Pair["capability"]["consumeReadCatch"]>>,
  ) {
    const failure = admitConfigureFailure(
      fact.phase,
      fact.resource,
      fact.ordinal,
      pair.record.request,
      fact.diagnostics,
    );
    const error = Error("OWNED_CONFIGURE_PROVIDER_REJECTED");
    Object.defineProperty(error, "failure", { value: failure });
    return error;
  }
  return Object.freeze({
    async invoke() {
      need(!used);
      used = true;
      need(arguments.length === 0);
      attempt.started = true;
      let actualError: Error | null = null;
      try {
        guard();
        await checked(() => assertConfigurePreflightFrontier(token));
        const original = await checked(() =>
          projectRenewalConfigurationV2(pair.record.configuration),
        );
        need(original.status === "projected_configure_request");
        const attachment = await checked(() =>
          constructRenewalScheduleAttachmentReceiptV2(
            pair.record.configuration.attachReceipt,
          ),
        );
        const record = verifyPreflightRecordDATA(
          pair.retained,
          original,
          attachment,
        );
        await checked(() => assertConfigurePreflightFrontier(token));
        const reader = createSelectedRawAcquisition(
          pair.owner,
          pair.transport.readTransport,
          attachment.scheduleId,
        );
        const acquired = await checked(() =>
          reader.acquire(record.configuration.preparation.expected),
        );
        if (!acquired.ok) {
          const fact = pair.capability.consumeReadCatch();
          if (fact) {
            actualError = providerFailure(fact);
            throw actualError;
          }
          return stop();
        }
        if (!matchesCurrentBundle(acquired.bundle, record))
          return configureControl(
            "not_dispatched",
            "preconfigure_baseline_changed",
          );
        const evidence = Object.freeze({
          bundle: acquired.bundle,
          schedule: acquired.schedule,
          observedAt: acquired.observedAt,
        });
        verifyCurrentPreflightDATA(record, evidence);
        const fresh = await checked(() =>
          projectRenewalConfigurationV2({
            ...record.configuration,
            freshSubscription: evidence.bundle.wireSubscription,
            targetPrice: evidence.bundle.wireTargetPrice,
            ...(Object.prototype.hasOwnProperty.call(
              record.configuration,
              "billingCustomer",
            )
              ? { billingCustomer: evidence.bundle.wireBillingCustomer }
              : {}),
            schedule: evidence.schedule,
            observedAt: evidence.observedAt,
          }),
        );
        need(
          fresh.status === "projected_configure_request" &&
            equal(fresh, original) &&
            equal(fresh, record.request),
        );
        need(
          Reflect.apply(pair.covers, pair.entry, [record, evidence, fresh]) ===
            true,
        );
        guard();
        releasePreflightDATA(record, evidence, fresh, original, attachment);
        attempt.freshEvidence = freeze(evidence);
        await checked(() => assertConfigurePreflightFrontier(token));
        const dispatch = {
          event: "dispatch",
          stage: "configure",
          request: original,
        };
        await checked(() => compiler.dispatch(dispatch));
        await checked(() => assertConfigureWriteFrontier(token, [dispatch]));
        const reply = await checked(() => pair.transport.postConfigure());
        if (pair.capability.consumeNotStarted(reply))
          return configureControl("not_dispatched", "post_not_started");
        const fact = pair.capability.consumePostCatch(reply);
        if (fact) {
          actualError = providerFailure(fact);
          throw actualError;
        }
        if (reply.outcome !== "fulfilled_safe")
          return configureControl("configure_unknown", "post_unverified");
        attempt.response = Object.freeze({
          body: reply.body,
          transport: reply.transport,
        });
        const response = {
          event: "response",
          stage: "configure",
          request: original,
          body: reply.body,
          transport: reply.transport,
        };
        await checked(() => compiler.response(response));
        const rawReceipt = Object.freeze({
          configuration: record.configuration,
          actualDispatch: seven(original),
          providerSnapshot: reply.body,
          transport: reply.transport,
        });
        const receipt = await checked(() =>
          constructRenewalConfigurationReceiptV2(rawReceipt),
        );
        // Known receipt closes this once-only attempt before output admission or persistence.
        receiptKnown = true;
        attempt.receipt = freeze(receipt);
        attempt.rawReceipt = freeze(rawReceipt);
        guard();
        const events = await checked(() =>
          assertConfigureWriteFrontier(token, [dispatch, response]),
        );
        const receiptJSON = JSON.stringify(renewalSnapshot(receipt));
        const retained: unknown = await checked(() => work.retain(receiptJSON));
        const retention = checkConfigureRetention(
          retained,
          lineage.reservation,
          events,
          receipt.binding,
        );
        attempt.retention = freeze(retention);
        const known = {
          receiptJSON,
          receiptBinding: receipt.binding,
          retention,
        };
        await checked(() =>
          assertConfigureWriteFrontier(token, [dispatch, response], known),
        );
        const output = admitConfigureACK(record, rawReceipt, receipt);
        const returned = closedFields(output, [
          "status",
          "originalRecord",
          "rawReceipt",
          "receipt",
          "operationalAuthority",
        ]);
        const published = {
          event: "receipt",
          stage: "configure",
          request: original,
          receipt,
        };
        await checked(() => compiler.receipt(published));
        await checked(() =>
          assertConfigureWriteFrontier(
            token,
            [dispatch, response, published],
            known,
          ),
        );
        const view: ConfigureCompletion = Object.freeze({
          output,
          receipt: returned.receipt,
          rawReceipt: returned.rawReceipt,
          acknowledgement: pair.preflight.acknowledgement,
          originalEntry: pair.preflight.originalEntry,
          configureEntry: pair.entry,
          coversConfigure: pair.covers,
          operationalAuthority: false,
        });
        guard();
        // No callback, reflection or Owner sample follows the final gate before discard.
        pair.capability.discardFulfilledQuarantine();
        attempt.completion = { view, guard };
        return output;
      } catch (error) {
        let live = false;
        try {
          guard();
          live = true;
        } catch {
          /* No reflection on provider data after closure. */
        }
        closed = true;
        if (live && actualError === error) throw error;
        if (pair.transport.postDisposition() !== "NOT_STARTED" || receiptKnown)
          return configureControl(
            "configure_unknown",
            live ? "post_unverified" : "owner_closed_after_post",
          );
        throw error;
      } finally {
        attempt.settled = true;
      }
    },
  });
}
