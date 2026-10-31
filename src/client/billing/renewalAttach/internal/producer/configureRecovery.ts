import {
  takeOriginalConfigureRecovery,
  readConfigureRecoveryAuthority,
  type ConfigureCompletion,
} from "./configureAttemptAuthority.js";
import { createAdmittedConfigureReplayTransport } from "../configure/transport.js";
import { readConfigureLineage } from "./configureLineage.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { createRecoveryConfigureEventCompiler } from "../c10/configureEvents.js";
import {
  assertConfigureRecoveryPrefix,
  assertConfigureWriteFrontier,
} from "./configureFrontier.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";
import { createSelectedRawAcquisition } from "../acquisition/ownedAcquisition.js";
import {
  verifyPreflightRecordDATA,
  verifyCurrentPreflightDATA,
} from "../preflight/relations.js";
import { releasePreflightDATA } from "../preflight/output.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalScheduleAttachmentReceiptV2,
  constructRenewalConfigurationReceiptV2,
} from "../../../renewalV2/index.js";
import { need, seven } from "../configure/request.js";
import {
  admitConfigureACK,
  admitConfigureFailure,
  configureControl,
} from "../configure/output.js";
import { withinConfigureRetention } from "../configure/replay.js";
import { freeze } from "../material/nodeKernel.js";
import { closed } from "../operations/types.js";
import {
  checkConfigureRetention,
  matchConfigureDATA,
} from "./configureJournalData.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import type { Bundle } from "../material/capture.js";
import type { PreflightRecord } from "../preflight/grammar.js";

function matchesBundle(
  value: unknown,
  record: PreflightRecord,
): value is Bundle {
  return equal(value, {
    ...record.originalBundle,
    wireSubscription: record.configuration.freshSubscription,
  });
}
/** One explicit same-live-Owner recovery reservation; no DATA registration input. */
export function captureAdmittedConfigureRecovery(token: object) {
  const recovery = takeOriginalConfigureRecovery(token, arguments.length);
  const { attempt } = readConfigureRecoveryAuthority(recovery),
    source = attempt.pair;
  const lineage = readConfigureLineage(token),
    owned = ownedAwaitForInitialLineage(lineage.parentToken);
  const compiler = createRecoveryConfigureEventCompiler(recovery),
    work = journalWorkForConfigureLineage(token);
  let used = false,
    closedActor = false;
  let pair = source;
  function guard() {
    need(!closedActor);
    readConfigureRecoveryAuthority(recovery);
    pair.guard();
  }
  async function checked<T>(call: () => T | PromiseLike<T>) {
    guard();
    const reply = await owned(call);
    guard();
    return reply;
  }
  function retentionWindow() {
    need(
      withinConfigureRetention(
        source.owner.check().nowSeconds,
        source.record.request.firstDispatchedAt,
      ),
    );
  }
  return Object.freeze({
    async invoke() {
      need(!used);
      used = true;
      need(arguments.length === 0);
      let actualError: Error | null = null;
      function providerFailure(
        fact: NonNullable<ReturnType<typeof pair.capability.consumeReadCatch>>,
      ) {
        const failure = admitConfigureFailure(
          fact.phase,
          fact.resource,
          fact.ordinal,
          source.record.request,
          fact.diagnostics,
        );
        const error = Error("OWNED_CONFIGURE_PROVIDER_REJECTED");
        Object.defineProperty(error, "failure", { value: failure });
        return error;
      }
      try {
        guard();
        need(work.idle());
        const original = source.record.request;
        const dispatch = {
          event: "dispatch",
          stage: "configure",
          request: original,
        };
        if (attempt.response === null && attempt.receipt === null) {
          await checked(() => assertConfigureWriteFrontier(token, [dispatch]));
          retentionWindow();
          pair = createAdmittedConfigureReplayTransport(token);
          const projected = await checked(() =>
            projectRenewalConfigurationV2(source.record.configuration),
          );
          need(
            projected.status === "projected_configure_request" &&
              equal(projected, original),
          );
          const attachment = await checked(() =>
            constructRenewalScheduleAttachmentReceiptV2(
              source.record.configuration.attachReceipt,
            ),
          );
          const record = verifyPreflightRecordDATA(
            source.retained,
            projected,
            attachment,
          );
          await checked(() => assertConfigureWriteFrontier(token, [dispatch]));
          retentionWindow();
          const reader = createSelectedRawAcquisition(
            source.owner,
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
            return configureControl(
              "not_dispatched",
              "fresh_reads_unavailable",
            );
          }
          if (!matchesBundle(acquired.bundle, record))
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
              equal(fresh, original),
          );
          need(
            Reflect.apply(source.covers, source.entry, [
              record,
              evidence,
              fresh,
            ]) === true,
          );
          guard();
          releasePreflightDATA(record, evidence, fresh, projected, attachment);
          attempt.recoveryEvidence = freeze(evidence);
          await checked(() => compiler.dispatch(dispatch));
          await checked(() => assertConfigureWriteFrontier(token, [dispatch]));
          retentionWindow();
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
        } else {
          need(attempt.response !== null);
          const response = {
            event: "response",
            stage: "configure",
            request: original,
            ...attempt.response,
          };
          const known = attempt.receipt
            ? {
                receiptJSON: JSON.stringify(renewalSnapshot(attempt.receipt)),
                receiptBinding: attempt.receipt.binding,
                retention: attempt.retention,
              }
            : null;
          const expected = [
            dispatch,
            response,
            ...(attempt.receipt
              ? [
                  {
                    event: "receipt",
                    stage: "configure",
                    request: original,
                    receipt: attempt.receipt,
                  },
                ]
              : []),
          ];
          const prefix = await checked(() =>
            assertConfigureRecoveryPrefix(token, expected, known),
          );
          if (prefix.retention) attempt.retention = freeze(prefix.retention);
          await checked(() => compiler.dispatch(dispatch));
        }
        const saved = attempt.response;
        need(saved);
        const response = {
          event: "response",
          stage: "configure",
          request: original,
          body: saved.body,
          transport: saved.transport,
        };
        await checked(() => compiler.response(response));
        if (attempt.receipt === null) {
          const raw = Object.freeze({
            configuration: source.record.configuration,
            actualDispatch: seven(original),
            providerSnapshot: saved.body,
            transport: saved.transport,
          });
          const receipt = await checked(() =>
            constructRenewalConfigurationReceiptV2(raw),
          );
          attempt.rawReceipt = freeze(raw);
          attempt.receipt = freeze(receipt);
        }
        const receipt = attempt.receipt,
          rawReceipt = attempt.rawReceipt;
        need(rawReceipt);
        const receiptJSON = JSON.stringify(renewalSnapshot(receipt));
        const published = {
          event: "receipt",
          stage: "configure",
          request: original,
          receipt,
        };
        const prefix = await checked(() =>
          assertConfigureRecoveryPrefix(
            token,
            [dispatch, response, published],
            {
              receiptJSON,
              receiptBinding: receipt.binding,
              retention: attempt.retention,
            },
          ),
        );
        const retained: unknown = await checked(() => work.retain(receiptJSON));
        const retention = checkConfigureRetention(
          retained,
          lineage.reservation,
          prefix.events,
          receipt.binding,
        );
        if (attempt.retention !== null)
          matchConfigureDATA(retention, attempt.retention);
        attempt.retention = freeze(retention);
        const known = {
          receiptJSON,
          receiptBinding: receipt.binding,
          retention,
        };
        await checked(() =>
          assertConfigureRecoveryPrefix(
            token,
            [dispatch, response, published],
            known,
          ),
        );
        const output = admitConfigureACK(source.record, rawReceipt, receipt);
        const returned = closed(output, [
          "status",
          "originalRecord",
          "rawReceipt",
          "receipt",
          "operationalAuthority",
        ]);
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
          acknowledgement: source.preflight.acknowledgement,
          originalEntry: source.preflight.originalEntry,
          configureEntry: source.entry,
          coversConfigure: source.covers,
          operationalAuthority: false,
        });
        guard();
        source.capability.discardFulfilledQuarantine();
        pair.capability.discardFulfilledQuarantine();
        attempt.completion = { view, guard };
        return output;
      } catch (error) {
        let live = false;
        try {
          guard();
          live = true;
        } catch {
          /* Closed custody allows no provider reflection. */
        }
        closedActor = true;
        if (live && actualError === error) throw error;
        return configureControl(
          "configure_unknown",
          live ? "recovery_unverified" : "owner_closed_after_post",
        );
      }
    },
  });
}
