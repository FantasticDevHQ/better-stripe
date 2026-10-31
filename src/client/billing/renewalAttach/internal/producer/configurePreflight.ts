import { readConfigureLineage } from "./configureLineage.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { assertConfigurePreflightFrontier } from "./configureFrontier.js";
import { createAdmittedConfigureReadTransport } from "../operations/configureReadTransport.js";
import { createSelectedRawAcquisition } from "../acquisition/ownedAcquisition.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
import {
  verifyPreflightRecordDATA,
  verifyCurrentPreflightDATA,
} from "../preflight/relations.js";
import { releasePreflightDATA } from "../preflight/output.js";
import { requireConfigure } from "./configureJournalData.js";
import { equal } from "../../../renewalAggregate/shared.js";
import type { PreflightOutput, PreflightRecord } from "../preflight/grammar.js";
import type { Bundle } from "../material/capture.js";

function matchesCurrentBundle(
  value: unknown,
  record: PreflightRecord,
): value is Bundle {
  return equal(value, {
    ...record.originalBundle,
    wireSubscription: record.configuration.freshSubscription,
  });
}
const captures = new WeakSet<object>();
type PreflightView = Readonly<{
  output: PreflightOutput;
  originalEntry: unknown;
  preflightEntry: unknown;
  coversPreflight: unknown;
  acknowledgement: ReturnType<
    typeof createAdmittedConfigureReadTransport
  >["acknowledgement"];
  operationalAuthority: false;
}>;
const completions = new WeakMap<
  object,
  { view: PreflightView; guard: () => void }
>();
/** Actual admitted child only. This readonly consistency actor grants no write. */
export function captureAdmittedConfigurePreflight(token: object) {
  requireConfigure(
    typeof token === "object" && token !== null && !captures.has(token),
  );
  captures.add(token);
  requireConfigure(arguments.length === 1);
  const pair = createAdmittedConfigureReadTransport(token);
  const lineage = readConfigureLineage(token),
    owned = ownedAwaitForInitialLineage(lineage.parentToken);
  let used = false,
    closed = false;
  function guard() {
    requireConfigure(!closed);
    try {
      pair.guard();
    } catch (error) {
      closed = true;
      throw error;
    }
  }
  async function checked<T>(call: () => T | PromiseLike<T>) {
    guard();
    const result = await owned(call);
    guard();
    return result;
  }
  const actor = Object.freeze({
    async invoke() {
      requireConfigure(!used);
      used = true;
      requireConfigure(arguments.length === 0);
      try {
        guard();
        await checked(() => assertConfigurePreflightFrontier(token));
        const original = await checked(() =>
          projectRenewalConfigurationV2(pair.retained.configuration),
        );
        requireConfigure(original.status === "projected_configure_request");
        const ack = await checked(() =>
          constructRenewalScheduleAttachmentReceiptV2(
            pair.retained.configuration.attachReceipt,
          ),
        );
        const record = verifyPreflightRecordDATA(pair.retained, original, ack);
        await checked(() => assertConfigurePreflightFrontier(token));
        guard();
        const reader = createSelectedRawAcquisition(
          lineage.owner,
          pair.readTransport,
          pair.scheduleId,
        );
        const acquired = await checked(() =>
          reader.acquire(record.configuration.preparation.expected),
        );
        requireConfigure(acquired.ok);
        requireConfigure(matchesCurrentBundle(acquired.bundle, record));
        const evidence = Object.freeze({
          bundle: acquired.bundle,
          schedule: acquired.schedule,
          observedAt: acquired.observedAt,
        });
        verifyCurrentPreflightDATA(record, evidence);
        guard();
        const configuration = {
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
        };
        const fresh = await checked(() =>
          projectRenewalConfigurationV2(configuration),
        );
        requireConfigure(
          fresh.status === "projected_configure_request" &&
            equal(fresh, original) &&
            equal(fresh, record.request),
        );
        requireConfigure(
          Reflect.apply(pair.covers, pair.entry, [record, evidence, fresh]) ===
            true,
        );
        guard();
        const output = releasePreflightDATA(
          record,
          evidence,
          fresh,
          original,
          ack,
        );
        await checked(() => assertConfigurePreflightFrontier(token));
        guard();
        completions.set(token, {
          guard,
          view: Object.freeze({
            output,
            originalEntry: pair.acknowledgement.originalEntry,
            preflightEntry: pair.entry,
            coversPreflight: pair.covers,
            acknowledgement: pair.acknowledgement,
            operationalAuthority: false as const,
          }),
        });
        return output;
      } catch (error) {
        closed = true;
        throw error;
      }
    },
  });
  return actor;
}
/** Actual completed return identity; copied output is never a registration input. */
export function readAdmittedConfigurePreflight(token: object) {
  requireConfigure(arguments.length === 1);
  const completed = completions.get(token);
  requireConfigure(completed);
  completed.guard();
  return completed.view;
}
