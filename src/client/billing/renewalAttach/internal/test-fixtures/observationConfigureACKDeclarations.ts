import assert from "node:assert/strict";
import { declareConfigureWriteCase } from "./configureWriteDeclarations.js";
import { deepFreeze } from "./configurePreflightControls.js";

export const optionalConfigureACKControlCases = [
  "actual19-default-null",
  "actual19-default-object",
  "cloned-returnedACK",
  "foreign-operation",
  "cloned-actual-operation",
  "raw-C9-input-instead-of-returnedACK",
  "own-ACK-undefined",
  "own-ACK-null",
  "ACK-present-operation-absent",
  "operation-present-ACK-absent",
] as const;
export type OptionalConfigureACKControl =
  (typeof optionalConfigureACKControlCases)[number];
export type OptionalConfigureACKCase =
  OptionalConfigureACKControl | "actual18-default-absent";

/** Only raw/data recipes here; all precede actual setup constructors. */
function declareOptionalConfigureACK(
  writerMode: "ack" | "defaults-null" | "defaults-object",
) {
  const writer = declareConfigureWriteCase(writerMode);
  const b = writer.currentBundle;
  assert.equal(typeof writer.response.id, "string");
  const scheduleId = writer.response.id;
  assert(typeof scheduleId === "string");
  const reads = {
    schedule: structuredClone(writer.response),
    subscription: structuredClone(b.wireSubscription),
    targetPrice: structuredClone(b.wireTargetPrice),
    billingCustomer: structuredClone(b.wireBillingCustomer),
    coupons: b.couponReads.map((row) => structuredClone(row.wireCoupon)),
  };
  const query = new URLSearchParams([
    ["expand[0]", "discounts"],
    ["expand[1]", "items.data.discounts"],
    ["expand[2]", "items.data.price"],
  ]);
  const e = writer.baseline.original.attachRequest.preparation.expected;
  const rows = [
    {
      resource: "schedule",
      path: "/v1/subscription_schedules/" + encodeURIComponent(scheduleId),
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
      path: "/v1/customers/" + encodeURIComponent(b.wireBillingCustomer.id),
      body: reads.billingCustomer,
    },
    ...b.couponReads.map((row) => ({
      resource: "coupon",
      path: "/v1/coupons/" + encodeURIComponent(row.couponId),
      body: row.wireCoupon,
    })),
  ];
  return deepFreeze({
    name:
      writerMode === "ack"
        ? "actual-published-ACK18"
        : "actual-published-ACK19",
    writer,
    reads,
    rows: rows.map((row, i) => ({
      ...row,
      ordinal: i + 1,
      options: {
        apiVersion: writer.baseline.apiVersion,
        maxNetworkRetries: 0 as const,
      },
    })),
    // Every declared writer response retains one phase. Absent/null defaults
    // lack a historical object; object defaults still do not prove configured phases.
    expectedObservation: {
      acknowledgementEstablished: false,
      authenticationEstablished: false,
      providerQualificationRequired: true,
      predicate: "unknown" as const,
      reason:
        writerMode === "defaults-object"
          ? "configured_baseline_material_unproven"
          : "incomplete_object",
    },
    observedAt: Math.floor(writer.writeAt / 1000),
  });
}
export type OptionalConfigureACK18 = ReturnType<
  typeof declareOptionalConfigureACK18
>;

/** Original no-argument raw declaration remains the fixed absent-default18 recipe. */
export function declareOptionalConfigureACK18() {
  return declareOptionalConfigureACK("ack");
}
export function declareOptionalConfigureACKCase(
  controlCase: OptionalConfigureACKCase,
) {
  const allowed: readonly string[] = [
    "actual18-default-absent",
    ...optionalConfigureACKControlCases,
  ];
  assert(allowed.includes(controlCase), "UNDECLARED_OPTIONAL_ACK_CASE");
  const writerMode =
    controlCase === "actual19-default-null"
      ? "defaults-null"
      : controlCase === "actual19-default-object"
        ? "defaults-object"
        : "ack";
  const stage =
    controlCase === "ACK-present-operation-absent" ||
    controlCase === "operation-present-ACK-absent"
      ? "grammar"
      : controlCase === "actual18-default-absent" ||
          controlCase.startsWith("actual19-")
        ? "positive"
        : "returned-value";
  return deepFreeze({
    controlCase,
    writerMode,
    stage,
    declaration: declareOptionalConfigureACK(writerMode),
  } as const);
}
