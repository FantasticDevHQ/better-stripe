import type {
  IdentityV1,
  Reason,
  RenewalEvidenceResultV1,
} from "./evidence-v1-types.js";
import { inspectTerminalEvidenceV1 } from "./terminal-evidence.js";
import { inspectInvoiceEvidenceV1 } from "./evidence-invoice.js";
import {
  inspectCurrentMaterialEvidenceV1,
  inspectHistoricalMaterialEvidenceV1,
  inspectConfiguredEvidenceV1,
} from "./evidence-material.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  reconstructConfigurationV2,
  type ProjectRenewalConfigurationV2Options,
  type ConstructRenewalConfigurationReceiptV2Options,
} from "../renewalV2/index.js";
import { captureObservation } from "../renewalV2/observationInput.js";
import { object, array, get, productId } from "./common.js";

function invalid(): never {
  throw Error("Invalid raw renewal evidence.");
}
function fields(raw: unknown, names: string[]) {
  const value = object(raw);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || names.some((k) => !keys.includes(k)))
    invalid();
  return value;
}
/** Copy the complete ordinary DATA model before any pure reconstruction. */
function capture(raw: unknown) {
  let nodes = 0;
  let characters = 0;
  const seen = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 10000 || depth > 40) invalid();
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 500000) invalid();
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || seen.has(value)) invalid();
    const isArray = Array.isArray(value);
    if (
      !isArray &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      invalid();
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    const entries: [string, unknown][] = [];
    const length = isArray
      ? Object.getOwnPropertyDescriptor(value, "length")
      : null;
    if (
      isArray &&
      (!length ||
        !("value" in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > 10000)
    )
      invalid();
    for (const key of keys) {
      if (isArray && key === "length") continue;
      if (typeof key !== "string") invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        invalid();
      characters += key.length;
      if (characters > 500000) invalid();
      if (
        isArray &&
        (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length!.value)
      )
        invalid();
      entries.push([key, copy(descriptor.value, depth + 1)]);
    }
    seen.delete(value);
    if (!isArray) return Object.fromEntries(entries);
    if (entries.length !== length!.value) invalid();
    const selected = new Map(entries);
    return Array.from({ length: length!.value }, (_, i) => {
      if (!selected.has(String(i))) invalid();
      return selected.get(String(i));
    });
  }
  try {
    const copied = renewalSnapshot(copy(raw, 0));
    if (new TextEncoder().encode(JSON.stringify(copied)).byteLength > 500000)
      invalid();
    return fields(copied, [
      "version",
      "apiVersion",
      "configuration",
      "configureReceipt",
      "reads",
      "invoiceContext",
      "historicalSnapshot",
    ]);
  } catch {
    invalid();
  }
}
function unknown(reason: Reason): RenewalEvidenceResultV1 {
  return {
    version: 1,
    kind: "renewal_evidence_data",
    apiVersion: "2026-09-30.endive",
    identity: null,
    lifecycle: {
      predicate: "unknown",
      providerStatus: null,
      facts: null,
      completion: null,
      reason,
    },
    currentMaterial: {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason,
    },
    historicalMaterial: {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason,
    },
    invoiceEvidence: {
      predicate: "unknown",
      original: null,
      current: null,
      reason,
    },
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    operationalAuthority: false,
    providerQualificationRequired: true,
  };
}
/** Unsigned terminal evidence DATA; no transport or operational admission. */
export async function inspectRenewalEvidenceV1(
  input: unknown,
): Promise<RenewalEvidenceResultV1> {
  const raw = capture(input);
  if (raw.apiVersion !== "2026-09-30.endive")
    return unknown("unsupported_api_version");
  if (raw.version !== 1) return unknown("unsupported_profile");
  let result = unknown("incomplete_material");
  try {
    const captured = captureObservation({
      configuration: raw.configuration,
      reads: raw.reads,
      ...(raw.configureReceipt === null
        ? {}
        : { configureReceipt: raw.configureReceipt }),
    });
    const reconstructed = await reconstructConfigurationV2(
      captured.configuration as ProjectRenewalConfigurationV2Options,
    );
    if (!reconstructed.material) return result;
    const { material, result: desired } = reconstructed;
    const prepared = material.prepared;
    const expected = object(prepared.expected);
    const originalSub = get(object(prepared.providerSnapshot), "subscription");
    const originalItem = object(array(get(originalSub, "items").data)[0]);
    const context = {
      customerAccountId: String(expected.customerAccountId),
      livemode: expected.livemode as boolean,
    };
    const identity: IdentityV1 = {
      scope: "platform",
      ...context,
      customerId: String(object(material.args.billingCustomer).id),
      scheduleId: material.receipt.scheduleId,
      subscriptionId: String(expected.subscriptionId),
      originalItemId: String(originalItem.id),
      targetPriceId: String(expected.targetPriceId),
      targetProductId: productId(
        object(material.args.targetPrice).product,
        context,
      ),
      originalNativePeriod: {
        start: Number(expected.periodStart),
        end: Number(expected.periodEnd),
      },
      targetBoundary: Number(expected.periodEnd),
    };
    result = { ...result, identity };
    const configured = await inspectConfiguredEvidenceV1({
      configuration:
        captured.configuration as ProjectRenewalConfigurationV2Options,
      configureReceipt: captured.configureReceipt
        ? (captured.configureReceipt as ConstructRenewalConfigurationReceiptV2Options)
        : null,
      owned: { ...material, request: desired },
    });
    const lifecycle = inspectTerminalEvidenceV1({
      identity,
      reads: captured.reads,
      originalSchedule: material.receipt.providerSnapshot,
      originalSub,
      originalCustomer: material.args.billingCustomer,
      target: material.args.targetPrice,
      desired,
      configured,
    });
    result = {
      ...result,
      lifecycle,
      currentMaterial: {
        predicate:
          lifecycle.reason === "owned_identity_mismatch"
            ? "conflict"
            : "unknown",
        observedItemId: null,
        nativePeriod: null,
        reason:
          lifecycle.reason === "owned_identity_mismatch"
            ? "owned_identity_mismatch"
            : "terminal_completion_unproven",
      },
      historicalMaterial: {
        predicate: "unknown",
        observedItemId: null,
        nativePeriod: null,
        reason:
          raw.historicalSnapshot === null
            ? "not_supplied"
            : "unsupported_profile",
      },
      invoiceEvidence: {
        predicate: "unknown",
        original: null,
        current: null,
        reason:
          raw.invoiceContext === null ? "not_supplied" : "unsupported_profile",
      },
    };
    if (
      lifecycle.predicate === "status_only" &&
      lifecycle.providerStatus === "active"
    )
      result = {
        ...result,
        currentMaterial: await inspectCurrentMaterialEvidenceV1(
          {
            configuration:
              captured.configuration as ProjectRenewalConfigurationV2Options,
            reads: {
              schedule: captured.reads.schedule,
              subscription: captured.reads.subscription,
              targetPrice: captured.reads.targetPrice,
              billingCustomer: captured.reads.billingCustomer,
              coupons: captured.reads.coupons,
            },
            ...(captured.configureReceipt
              ? {
                  configureReceipt:
                    captured.configureReceipt as ConstructRenewalConfigurationReceiptV2Options,
                }
              : {}),
          },
          raw.invoiceContext,
        ),
      };
    if (raw.invoiceContext !== null)
      result = {
        ...result,
        invoiceEvidence: await inspectInvoiceEvidenceV1(raw),
      };
    if (raw.historicalSnapshot !== null)
      result = {
        ...result,
        historicalMaterial: await inspectHistoricalMaterialEvidenceV1(raw),
      };
    return result;
  } catch {
    return result;
  }
}
