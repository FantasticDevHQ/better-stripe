import {
  declarePreflightCase,
  deepFreeze,
} from "./configurePreflightControls.js";

export const sourceControlCases = [
  "G02-arity",
  "G02-once",
  "G02-owner",
  "G02-origin",
  "G02-entry",
  "G02-observation-entry",
  "G02-ack-clone",
  "G02-tuple-proxy",
  "G02-method-getter",
  "G02-optional-undefined",
  "G02-optional-null",
  "G02-optional-present",
] as const;
export const publicFailureCases = [
  "G03-failure",
  "G03-structural",
  "G03-retire",
] as const;
export const trustedExportCases = [
  "ABI-data-export",
  "ABI-getter-once",
  "ABI-getter-retire",
  "ABI-undefined-export",
  "ABI-nonfunction-export",
  "ABI-proxy-function-export",
  "ABI-getter-throws",
] as const;
export const transportControlCases = [
  "G04-schedule-fulfill",
  "G04-schedule-reject",
  "G04-coupon-fulfill",
  "G04-coupon-reject",
  "G06-actual-schedule",
  "G06-actual-coupon",
  "G06-empty-diagnostics",
  "G06-diagnostics",
  "G06-retire-catch",
] as const;
export const observationControls = [
  "positive",
  "G02-empty",
  ...sourceControlCases,
  ...publicFailureCases,
  ...trustedExportCases,
  ...transportControlCases,
] as const;
export type ObservationControl = (typeof observationControls)[number];

/** Fixed complete positive raw input and clock cues precede all constructors. */
export function declareObservationPositive(
  controlCase: ObservationControl = "positive",
) {
  if (!observationControls.includes(controlCase))
    throw Error("UNDECLARED_OBSERVATION_CASE");
  const baseline = declarePreflightCase("positive");
  const b = baseline.baselineBundle;
  const reads = {
    schedule: structuredClone(baseline.schedule),
    subscription: structuredClone(b.wireSubscription),
    targetPrice: structuredClone(b.wireTargetPrice),
    billingCustomer: structuredClone(b.wireBillingCustomer),
    coupons: b.couponReads.map((row) => structuredClone(row.wireCoupon)),
  };
  const expected = {
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    providerQualificationRequired: true,
    predicate: "attached_unconfigured_match",
  } as const;
  const query = new URLSearchParams([
    ["expand[0]", "discounts"],
    ["expand[1]", "items.data.discounts"],
    ["expand[2]", "items.data.price"],
  ]);
  const e = baseline.original.attachRequest.preparation.expected;
  const rows = [
    {
      resource: "schedule",
      path:
        "/v1/subscription_schedules/" +
        encodeURIComponent(baseline.schedule.id),
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
    mode: "G01-owned-absent-ACK" as const,
    controlCase,
    expectedOwner:
      controlCase === "G03-retire" ||
      controlCase === "ABI-getter-retire" ||
      controlCase.startsWith("G04-") ||
      controlCase === "G06-retire-catch"
        ? ("retired" as const)
        : ("live" as const),
    transport: {
      active: controlCase.startsWith("G04-") || controlCase.startsWith("G06-"),
      held: controlCase.startsWith("G04-"),
      ordinal: controlCase.includes("coupon") ? rows.length : 1,
      reject: controlCase.startsWith("G06-") || controlCase.endsWith("-reject"),
      emptyDiagnostics: controlCase === "G06-empty-diagnostics",
      safeDiagnostics: controlCase === "G06-actual-coupon",
      hostileDiagnostics:
        controlCase === "G06-diagnostics" ||
        controlCase === "G06-retire-catch" ||
        controlCase.endsWith("-reject"),
      retireAtCatch: controlCase === "G06-retire-catch",
      safe: {
        type: "api_error",
        code: "TEST_DECLARED_CODE",
        statusCode: 409,
        requestId: "req_safe",
      },
      unsafeRequestId: "Bearer TEST_SECRET_NOT_A_CREDENTIAL",
      expectedDiagnostics:
        controlCase === "G06-empty-diagnostics"
          ? {}
          : controlCase === "G06-actual-coupon"
            ? {
                type: "api_error",
                code: "TEST_DECLARED_CODE",
                statusCode: 409,
                requestId: "req_safe",
              }
            : { type: "StripeConnectionError" },
    },
    invalidAPI: "2026-01-01.unsupported",
    foreign: Object.freeze({ declared: "TEST_FOREIGN_POINTER" }),
    exportThrow: "TEST_DECLARED_TRUSTED_EXPORT_THROW",
    baseline,
    reads,
    expected,
    rows: rows.map((row, index) => ({
      ...row,
      ordinal: index + 1,
      method: "GET" as const,
      options: {
        apiVersion: baseline.apiVersion,
        maxNetworkRetries: 0 as const,
      },
    })),
    // Existing fixture advances its original Source to baseAt. No setter is exposed.
    // Positive can sample that same live clock; distinct later-time controls are held.
    expectedOwnerAt: baseline.baseAt,
    originalFirstAt: baseline.firstAt,
    retentionEpoch: baseline.original.attachRequest.firstDispatchedAt,
  });
}
export type ObservationDeclaration = ReturnType<
  typeof declareObservationPositive
>;
export const heldObservationCases = Object.freeze({
  structural:
    "Direct public rejection plus possible earlier private capture; not target-C6 throw proof",
  outputDataCap: "Helper-only, not actor-reachable output overflow",
  ownKeysAndRepeatedOriginal:
    "Need explicit stateless fixture extraction before authoring",
  distinctFinalAndLaterSample:
    "Existing fixture exposes no clock advance; no replacement clock allowed",
  old43: "Actual opaque initial43 token unbound",
  optionalACKAndHistory:
    "Actual optional ACK18/19/history/effective remain required",
});
