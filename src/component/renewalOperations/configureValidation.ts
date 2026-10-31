import { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import { captureConfigureSource } from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import { reconstructConfigurationV2 } from "../../client/billing/renewalV2/index.js";
import { equal } from "../../client/billing/renewalAggregate/shared.js";

export function configureConflict(): never {
  throw Error("RENEWAL_JOURNAL_CONFLICT");
}
export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    configureConflict();
  return value as Record<string, unknown>;
}
/** Complete C3/C6/C7 reconstruction of unsigned configure DATA. */
export async function validateOperationalConfigureSource(
  full: ReturnType<typeof canonicalJournalRecord>,
) {
  try {
    const original = jsonObject(JSON.parse(full.json));
    const source = jsonObject(original.configureRecord);
    const keys = [
      "configuration",
      "request",
      "attachReceipt",
      "originalBundle",
    ];
    if (
      Object.keys(source).length !== keys.length ||
      Object.keys(source).some((key) => !keys.includes(key))
    )
      configureConflict();
    const configuration = captureConfigureSource(source.configuration);
    // The constructor revalidates all semantic fields of this captured JSON DATA.
    const rebuilt = await reconstructConfigurationV2(configuration);
    if (!rebuilt.material || !("requestIdentity" in rebuilt.result))
      configureConflict();
    const { prepared, receipt } = rebuilt.material;
    const request = rebuilt.result;
    const account = jsonObject(original.account);
    const policy = jsonObject(original.timingPolicy);
    const seven = {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    };
    if (
      original.stage !== "configure" ||
      original.apiVersion !== request.apiVersion ||
      !equal(source.configuration, configuration) ||
      !equal(source.request, request) ||
      !equal(source.attachReceipt, receipt) ||
      !equal(original.dispatch, seven) ||
      full.requestBinding !== request.requestIdentity.binding ||
      account.mode !== "platform" ||
      account.stripeAccount !== null ||
      account.livemode !== prepared.expected.livemode ||
      policy.firstDispatchedAt !== request.firstDispatchedAt ||
      policy.periodStart !== prepared.expected.periodStart ||
      policy.periodEnd !== prepared.expected.periodEnd
    )
      configureConflict();
    return { original, source, configuration, request, receipt };
  } catch {
    return configureConflict();
  }
}
