import assert from "node:assert/strict";
import { expect } from "vitest";
import { observationInput } from "./fixtures.js";
import {
  reconstructConfigurationV2,
  projectRenewalConfigurationV2,
  constructRenewalConfigurationReceiptV2,
  type ConstructRenewalConfigurationReceiptV2Options,
} from "../../src/client/billing/renewalV2/index.js";
import { inspectRenewalScheduleMaterialV2 } from "../../src/client/billing/renewalV2/observation.js";
import { createContext } from "../../src/client/billing/renewalObservation/scheduled-context.js";
import { runStages } from "../../src/client/billing/renewalObservation/stage-runner.js";
import { renewalSnapshot } from "../../src/client/billing/renewalReplacementSnapshot.js";
import {
  object,
  array,
  get,
} from "../../src/client/billing/renewalObservation/common.js";
import type {
  CurrentMaterialV1,
  IdentityV1,
  LifecycleV1,
  Reason,
  RenewalEvidenceInputV1,
  RenewalEvidenceResultV1,
  TerminalFactsV1,
} from "../../src/client/billing/renewalObservation/evidence-v1-types.js";

export const API = "2026-09-30.endive" as const;
export function set(value: object, key: string, next: unknown) {
  Object.defineProperty(value, key, {
    value: next,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export function recipe(mode: "attached" | "pending" | "active" = "active") {
  const raw = observationInput(mode === "active", true);
  if (mode === "attached")
    raw.reads.schedule = structuredClone(raw.configuration.schedule);
  const input: RenewalEvidenceInputV1 = {
    version: 1,
    apiVersion: API,
    configuration: raw.configuration,
    configureReceipt: null,
    reads: raw.reads,
    invoiceContext: null,
    historicalSnapshot: null,
  };
  return { input, baseline: structuredClone(raw), mode };
}
export type Recipe = ReturnType<typeof recipe>;
export function identity(input: RenewalEvidenceInputV1): IdentityV1 {
  const p = input.configuration.preparation;
  const sub = object(p.subscription);
  const item = object(array(get(sub, "items").data)[0]);
  return {
    scope: "platform",
    customerAccountId: p.expected.customerAccountId,
    customerId: String(object(input.configuration.billingCustomer).id),
    livemode: p.expected.livemode,
    scheduleId: String(object(input.configuration.schedule).id),
    subscriptionId: p.expected.subscriptionId,
    originalItemId: String(item.id),
    targetPriceId: p.expected.targetPriceId,
    targetProductId: String(object(input.configuration.targetPrice).product),
    originalNativePeriod: {
      start: p.expected.periodStart,
      end: p.expected.periodEnd,
    },
    targetBoundary: p.expected.periodEnd,
  };
}
export function unknownResult(reason: Reason): RenewalEvidenceResultV1 {
  return {
    version: 1,
    kind: "renewal_evidence_data",
    apiVersion: API,
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
export function evidence(
  input: RenewalEvidenceInputV1,
  lifecycle: LifecycleV1,
  currentMaterial: CurrentMaterialV1,
): RenewalEvidenceResultV1 {
  return {
    ...unknownResult("incomplete_material"),
    identity: identity(input),
    lifecycle,
    currentMaterial,
    historicalMaterial: {
      predicate: "unknown",
      observedItemId: null,
      nativePeriod: null,
      reason: "not_supplied",
    },
    invoiceEvidence: {
      predicate: "unknown",
      original: null,
      current: null,
      reason: "not_supplied",
    },
  };
}
export const activeLifecycle: LifecycleV1 = {
  predicate: "status_only",
  providerStatus: "active",
  facts: null,
  completion: null,
  reason: null,
};
export function facts(input: RenewalEvidenceInputV1): TerminalFactsV1 {
  const schedule = object(input.reads.schedule);
  const time = (key: string) => ({
    presence: "present" as const,
    value: schedule[key] === null ? null : Number(schedule[key]),
  });
  const relation = (key: string) => ({
    presence: "present" as const,
    value: schedule[key] === null ? null : String(schedule[key]),
  });
  return {
    canceledAt: time("canceled_at"),
    completedAt: time("completed_at"),
    releasedAt: time("released_at"),
    subscriptionId: relation("subscription"),
    releasedSubscriptionId: relation("released_subscription"),
  };
}
export function complete(input: RenewalEvidenceInputV1) {
  const schedule = object(input.reads.schedule);
  const end = Number(object(array(schedule.phases)[1]).end_date);
  set(schedule, "status", "completed");
  set(schedule, "subscription", null);
  set(schedule, "current_phase", null);
  set(schedule, "completed_at", end + 60);
  set(schedule, "canceled_at", null);
  set(schedule, "released_at", null);
  set(schedule, "released_subscription", null);
  set(object(input.reads.subscription), "schedule", null);
}
export function completionLifecycle(
  input: RenewalEvidenceInputV1,
): LifecycleV1 {
  const id = identity(input),
    schedule = object(input.reads.schedule);
  const end = Number(object(array(schedule.phases)[1]).end_date);
  return {
    predicate: "completed_correlated",
    providerStatus: "completed",
    facts: facts(input),
    completion: {
      scheduleId: id.scheduleId,
      subscriptionId: id.subscriptionId,
      completedAt: Number(schedule.completed_at),
      targetPeriod: { start: id.targetBoundary, end },
      finalPhaseEnd: end,
      endBehavior: "release",
      comparison: "full_normalized_phase_history_match",
    },
    reason: null,
  };
}
/** Pure raw constructor prerequisites, never provider or provenance evidence. */
export async function prerequisites(h: Recipe) {
  const reconstructed = await reconstructConfigurationV2(h.input.configuration);
  assert(reconstructed.material);
  expect(reconstructed.result.status).toBe("projected_configure_request");
  const expected =
    h.mode === "active"
      ? {
          predicate: "current_target_material_match",
          observedItemId: "si_successor",
          nativePeriod: {
            start: identity(h.input).targetBoundary,
            end: Number(
              object(array(object(h.baseline.reads.schedule).phases)[1])
                .end_date,
            ),
          },
        }
      : {
          predicate:
            h.mode === "attached"
              ? "attached_unconfigured_match"
              : "pending_material_match",
        };
  expect(await inspectRenewalScheduleMaterialV2(h.baseline)).toEqual({
    ...expected,
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    providerQualificationRequired: true,
  });
  return reconstructed;
}
/** Snapshot/configuration choices are fixed by the recipe before these calls.
 * Dispatch is the actual independently exercised V2 projection, not the new target.
 */
export async function suppliedC9(
  h: Recipe,
  snapshot: Record<string, unknown>,
  configuration = h.input.configuration,
) {
  const request = await projectRenewalConfigurationV2(configuration);
  assert(request.status === "projected_configure_request");
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  const raw: ConstructRenewalConfigurationReceiptV2Options = {
    configuration,
    actualDispatch: {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    },
    providerSnapshot: snapshot,
    transport: { status: 200, requestId: "req_TEST_unsigned_C9" },
  };
  const receipt = await constructRenewalConfigurationReceiptV2(raw);
  expect(receipt.providerSnapshot).toEqual(snapshot);
  expect(receipt.request).toEqual(request);
  const reconstructed = await reconstructConfigurationV2(configuration);
  assert(reconstructed.material);
  const { material, result } = reconstructed;
  const originalSub = get(
    object(material.prepared.providerSnapshot),
    "subscription",
  );
  const originalItem = object(array(get(originalSub, "items").data)[0]);
  const coupons = new Map<string, Record<string, unknown>>();
  for (const discount of [
    ...array(originalSub.discounts),
    ...array(originalItem.discounts),
  ]) {
    const coupon = get(get(object(discount), "source"), "coupon");
    coupons.set(String(coupon.id), coupon);
  }
  const historical = {
    schedule: receipt.providerSnapshot,
    subscription: material.args.freshSubscription,
    targetPrice: material.args.targetPrice,
    billingCustomer: material.args.billingCustomer,
    coupons: [...coupons.values()],
  };
  let baseline: ReturnType<typeof runStages> | null = null;
  let baselineError: unknown;
  try {
    baseline = runStages(
      createContext({ ...material, request: result }, historical, "baseline"),
    );
  } catch (error) {
    baselineError = error;
  }
  set(h.input, "configureReceipt", raw);
  return { receipt, baseline, baselineError };
}
export function model(input: unknown) {
  let nodes = 0,
    depth = 0;
  function walk(value: unknown, d: number) {
    nodes++;
    depth = Math.max(depth, d);
    if (value && typeof value === "object")
      for (const next of Object.values(value)) walk(next, d + 1);
  }
  walk(input, 0);
  const json = JSON.stringify(input);
  return {
    nodes,
    depth,
    characters: json.length,
    bytes: new TextEncoder().encode(json).length,
  };
}
export function bounded(input: unknown) {
  const result = model(input);
  expect(result.nodes).toBeLessThanOrEqual(10000);
  expect(result.depth).toBeLessThanOrEqual(40);
  expect(result.characters).toBeLessThanOrEqual(500000);
  expect(result.bytes).toBeLessThanOrEqual(500000);
  return renewalSnapshot(input);
}

export type InvoiceStatus =
  "draft" | "open" | "paid" | "uncollectible" | "void" | null;
/** Complete synthetic declarations, not captured Stripe responses or payments. */
export function invoiceRecipe(
  originalReason:
    "subscription_create" | "subscription_cycle" = "subscription_create",
  status: InvoiceStatus = "open",
  decimalMode: "standard" | "large-decimal" = "standard",
) {
  const h = recipe("active"),
    id = identity(h.input);
  if (decimalMode === "large-decimal") {
    const decimal = "9007199254740991.000000000001";
    const updatePrice = (raw: unknown) => {
      const price = object(raw);
      set(price, "unit_amount", null);
      set(price, "unit_amount_decimal", decimal);
    };
    for (const configuration of [
      h.input.configuration,
      h.baseline.configuration,
    ]) {
      updatePrice(configuration.preparation.targetPrice);
      updatePrice(
        configuration.attachReceipt.attachRequest.preparation.targetPrice,
      );
      updatePrice(configuration.targetPrice);
    }
    for (const reads of [h.input.reads, h.baseline.reads]) {
      updatePrice(reads.targetPrice);
      const item = object(
        array(get(object(reads.subscription), "items").data)[0],
      );
      updatePrice(item.price);
      const plan = object(item.plan);
      set(plan, "amount", null);
      set(plan, "amount_decimal", decimal);
    }
  }
  const originalSub = object(h.input.configuration.preparation.subscription);
  const originalItem = object(array(get(originalSub, "items").data)[0]);
  const currentSub = object(h.input.reads.subscription);
  const currentItem = object(array(get(currentSub, "items").data)[0]);
  const originalPrice = object(originalItem.price),
    targetPrice = object(currentItem.price);
  const line = (original: boolean) => {
    const item = original ? originalItem : currentItem;
    const price = original ? originalPrice : targetPrice;
    return {
      id: original ? "il_original" : "il_current",
      object: "line_item" as const,
      invoice: original ? "in_original" : "in_current",
      livemode: id.livemode,
      currency: "usd",
      amount: original ? 3000 : 6000,
      subtotal: original ? 3000 : 6000,
      description: null,
      metadata: { preserve: "complete unsigned invoice line" },
      discount_amounts: null,
      discountable: true,
      discounts: [],
      pretax_credit_amounts: null,
      taxes: null,
      parent: {
        type: "subscription_item_details" as const,
        invoice_item_details: null,
        subscription_item_details: {
          subscription: id.subscriptionId,
          subscription_item: String(item.id),
          proration: false,
        },
      },
      period: {
        start: Number(item.current_period_start),
        end: Number(item.current_period_end),
      },
      pricing: {
        type: "price_details" as const,
        price_details: {
          price: String(price.id),
          product: String(price.product),
        },
        unit_amount_decimal: String(price.unit_amount_decimal),
      },
      quantity: Number(item.quantity),
      quantity_decimal: String(item.quantity),
      subscription: id.subscriptionId,
    };
  };
  const originalLine = line(true),
    currentLine = line(false);
  const page = (invoiceId: string, data: unknown[]) => ({
    object: "list" as const,
    url: `/v1/invoices/${invoiceId}/lines`,
    has_more: false,
    data,
  });
  const invoice = (original: boolean) => ({
    id: original ? "in_original" : "in_current",
    object: "invoice" as const,
    customer_account: id.customerAccountId,
    customer: id.customerId,
    livemode: id.livemode,
    currency: "usd",
    status,
    billing_reason: original ? originalReason : "subscription_cycle",
    parent: {
      type: "subscription_details" as const,
      subscription_details: { subscription: id.subscriptionId, metadata: {} },
    },
    period_start: original
      ? originalLine.period.start
      : currentLine.period.start,
    period_end: original ? originalLine.period.end : currentLine.period.end,
    metadata: { preserve: "complete unsigned invoice" },
    description: null,
    status_transitions: {
      finalized_at: null,
      paid_at: null,
      marked_uncollectible_at: null,
      voided_at: null,
    },
  });
  const originalInvoice = invoice(true),
    currentInvoice = invoice(false);
  const originalPages = [page("in_original", [originalLine])];
  const currentPages = [page("in_current", [currentLine])];
  set(currentSub, "latest_invoice", "in_current");
  set(h.input, "invoiceContext", {
    original: { invoice: originalInvoice, linePages: originalPages },
    current: { invoice: currentInvoice, linePages: currentPages },
  });
  return {
    h,
    originalLine,
    currentLine,
    originalInvoice,
    currentInvoice,
    originalPages,
    currentPages,
  };
}
export type InvoiceRecipe = ReturnType<typeof invoiceRecipe>;
export function invoiceMatch(f: InvoiceRecipe) {
  const match = (original: boolean) => {
    const invoice = original ? f.originalInvoice : f.currentInvoice;
    const line = original ? f.originalLine : f.currentLine;
    return {
      invoiceId: invoice.id,
      lineId: line.id,
      subscriptionItemId:
        line.parent.subscription_item_details.subscription_item,
      nativePeriod: { ...line.period },
      priceId: line.pricing.price_details.price,
      productId: line.pricing.price_details.product,
      currency: line.currency,
      quantityDecimal: line.quantity_decimal,
      unitAmountDecimal: line.pricing.unit_amount_decimal,
      invoiceStatus: invoice.status,
    };
  };
  return {
    predicate: "invoice_lines_correlated" as const,
    original: match(true),
    current: match(false),
    reason: null,
  };
}
export function currentTarget(
  input: RenewalEvidenceInputV1,
): Extract<CurrentMaterialV1, { predicate: "current_target_material_match" }> {
  const item = object(
    array(get(object(input.reads.subscription), "items").data)[0],
  );
  return {
    predicate: "current_target_material_match",
    observedItemId: String(item.id),
    nativePeriod: {
      start: Number(item.current_period_start),
      end: Number(item.current_period_end),
    },
    reason: null,
  };
}
