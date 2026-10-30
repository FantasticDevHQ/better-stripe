import assert from "node:assert/strict";
import { declareConfigureWriteCase } from "./configureWriteDeclarations.js";
import { deepFreeze } from "./configurePreflightControls.js";
import { configuredHistoryLiveReads } from "./observationConfiguredHistoryNative.js";

export const configuredHistoryCases = [
  "H01-pending",
  "H02-active",
  "H03-history-onephase",
  "H04-history-opaque-drift",
  "H05-live-target-end",
  "H06-live-default-drift",
  "H07-active-invoice-I0-I1",
  "H08-active-unknown-metadata",
  "H09-live-coupon-counter",
  "H10-live-customer-sequence",
] as const;
export type ConfiguredHistoryCase = (typeof configuredHistoryCases)[number];
const unsigned = {
  acknowledgementEstablished: false,
  authenticationEstablished: false,
  providerQualificationRequired: true,
} as const;
/** Every complete writer/live raw scenario and exact result precedes all constructors. */
export function declareConfiguredHistoryCase(
  controlCase: ConfiguredHistoryCase,
) {
  assert(
    (configuredHistoryCases as readonly string[]).includes(controlCase),
    "UNDECLARED_CONFIGURED_HISTORY_CASE",
  );
  const writerMode =
    controlCase === "H03-history-onephase"
      ? "configured-history-onephase"
      : controlCase === "H04-history-opaque-drift"
        ? "configured-history-drift"
        : "configured-history";
  const writer = declareConfigureWriteCase(writerMode);
  const active =
    controlCase === "H02-active" ||
    controlCase === "H07-active-invoice-I0-I1" ||
    controlCase === "H08-active-unknown-metadata";
  const reads = configuredHistoryLiveReads(writer.baseline, active);
  if (controlCase === "H05-live-target-end")
    reads.schedule.phases[1]!.end_date++;
  if (controlCase === "H06-live-default-drift")
    Object.defineProperty(reads.schedule.default_settings, "description", {
      value: "TEST_DECLARED_DEFAULT_DRIFT",
      enumerable: true,
      configurable: true,
      writable: true,
    });
  if (controlCase === "H07-active-invoice-I0-I1")
    reads.subscription.latest_invoice = "in_successor";
  if (controlCase === "H08-active-unknown-metadata")
    reads.subscription.metadata.keep = "TEST_DECLARED_ACTIVE_DRIFT";
  if (controlCase === "H09-live-coupon-counter")
    reads.coupons[0]!.times_redeemed++;
  if (controlCase === "H10-live-customer-sequence")
    reads.billingCustomer.next_invoice_sequence++;
  const results = {
    "H01-pending": { ...unsigned, predicate: "pending_material_match" },
    "H02-active": {
      ...unsigned,
      predicate: "current_target_material_match",
      observedItemId: "si_successor",
      nativePeriod: { start: 1771113600, end: 1773532800 },
    },
    "H03-history-onephase": {
      ...unsigned,
      predicate: "unknown",
      reason: "configured_baseline_material_unproven",
    },
    "H04-history-opaque-drift": {
      ...unsigned,
      predicate: "conflict",
      reason: "full_phase_or_default_read_drift",
    },
    "H05-live-target-end": {
      ...unsigned,
      predicate: "conflict",
      reason: "configured_ack_full_baseline_drift",
    },
    "H06-live-default-drift": {
      ...unsigned,
      predicate: "conflict",
      reason: "full_phase_or_default_read_drift",
    },
    "H07-active-invoice-I0-I1": {
      ...unsigned,
      predicate: "conflict",
      reason: "effective_full_material_drift",
    },
    "H08-active-unknown-metadata": {
      ...unsigned,
      predicate: "conflict",
      reason: "effective_full_material_drift",
    },
    "H09-live-coupon-counter": {
      ...unsigned,
      predicate: "conflict",
      reason: "expanded_coupon_read_drift",
    },
    "H10-live-customer-sequence": {
      ...unsigned,
      predicate: "conflict",
      reason: "billing_customer_full_read_drift",
    },
  };
  const e = writer.baseline.original.attachRequest.preparation.expected;
  const query = new URLSearchParams([
    ["expand[0]", "discounts"],
    ["expand[1]", "items.data.discounts"],
    ["expand[2]", "items.data.price"],
  ]);
  const rows = [
    {
      resource: "schedule",
      path:
        "/v1/subscription_schedules/" + encodeURIComponent(reads.schedule.id),
      body: reads.schedule,
    },
    {
      resource: "subscription",
      path:
        "/v1/subscriptions/" +
        encodeURIComponent(e.subscriptionId) +
        "?" +
        query,
      body: reads.subscription,
    },
    {
      resource: "price",
      path: "/v1/prices/" + encodeURIComponent(e.targetPriceId),
      body: reads.targetPrice,
    },
    {
      resource: "customer",
      path: "/v1/customers/" + encodeURIComponent(reads.billingCustomer.id),
      body: reads.billingCustomer,
    },
    ...reads.coupons.map((coupon) => ({
      resource: "coupon",
      path: "/v1/coupons/" + encodeURIComponent(coupon.id),
      body: coupon,
    })),
  ];
  return deepFreeze({
    controlCase,
    writerMode,
    writer,
    reads,
    historyPhaseCount: controlCase === "H03-history-onephase" ? 1 : 2,
    expectedObservation: results[controlCase],
    expectedWithoutReceipt: {
      ...unsigned,
      predicate: "unknown",
      reason: "future_duration_not_bound",
    },
    observedAt: Math.floor(writer.writeAt / 1000),
    rows: rows.map((row, i) => ({
      ...row,
      ordinal: i + 1,
      options: {
        apiVersion: writer.baseline.apiVersion,
        maxNetworkRetries: 0 as const,
      },
    })),
  } as const);
}
