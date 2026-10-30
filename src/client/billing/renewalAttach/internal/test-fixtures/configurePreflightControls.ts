import { makeConfigureReadNativeBaseline } from "./configureReadNativeBaseline.js";

export type PreflightCase =
  | "positive"
  | "foreign-owner"
  | "foreign-origin"
  | "foreign-entry"
  | "foreign-preflight-entry"
  | "foreign-delegate"
  | "method-retarget"
  | "foreign-ack"
  | "foreign-pair"
  | "retired-capture"
  | "retired-proxy"
  | "original-failure"
  | "record-token"
  | "subscription-drift"
  | "price-drift"
  | "customer-drift"
  | "coupon-drift"
  | "reference-drift"
  | "schedule-opaque"
  | "schedule-default"
  | "schedule-phase"
  | "hold-schedule"
  | "hold-original"
  | "hold-fresh"
  | "later-sample"
  | "output-overflow";

export function data(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("TEST_DATA_PREREQUISITE");
  return value as Record<string, unknown>;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    ))
      if ("value" in descriptor) deepFreeze(descriptor.value);
    Object.freeze(value);
  }
  return value;
}

/** Every raw counterexample and sample cue is declared before any constructor. */
export function declarePreflightCase(name: PreflightCase) {
  const baseline = makeConfigureReadNativeBaseline();
  const original = structuredClone(baseline.original);
  const schedule = structuredClone(baseline.schedule);
  if (name === "output-overflow")
    Object.assign(schedule.metadata, { opaque: "x".repeat(135000) });
  const baselineBundle = {
    ...structuredClone(original.originalBundle),
    wireSubscription: {
      ...structuredClone(original.originalBundle.wireSubscription),
      schedule: schedule.id,
    },
  };
  const currentBundle = structuredClone(baselineBundle);
  const currentSchedule = structuredClone(schedule);
  if (name === "subscription-drift")
    Object.assign(currentBundle.wireSubscription.metadata, { drift: "Sub" });
  if (name === "price-drift")
    Object.assign(currentBundle.wireTargetPrice.metadata, { drift: "Price" });
  if (name === "customer-drift")
    Object.assign(currentBundle.wireBillingCustomer.metadata, {
      drift: "Customer",
    });
  if (name === "coupon-drift")
    currentBundle.couponReads[0]!.wireCoupon.times_redeemed++;
  if (name === "reference-drift") {
    const source = currentBundle.wireSubscription.discounts[0]!.source;
    Object.defineProperty(source, "coupon", {
      value: source.coupon.id,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (name === "schedule-opaque")
    Object.assign(currentSchedule.metadata, { drift: "Schedule" });
  if (name === "schedule-default")
    Object.assign(currentSchedule.default_settings, {
      description: "different",
    });
  if (name === "schedule-phase")
    currentSchedule.phases[0]!.metadata = { drift: "phase" };
  return deepFreeze({
    name,
    original,
    schedule,
    baselineBundle,
    currentBundle,
    currentSchedule,
    apiVersion: baseline.apiVersion,
    configureKey: baseline.configureKey,
    configureAt: baseline.configurationTime,
    originalAPI:
      name === "original-failure"
        ? "unsupported-preflight-api"
        : baseline.apiVersion,
    badRecordBinding: "renewal:v2:sha256:" + "a".repeat(64),
    firstAt: baseline.clockPlan.attachSeconds * 1000 + 1,
    baseAt: baseline.clockPlan.observationSeconds * 1000 + 1001,
    scheduleAt: baseline.clockPlan.observationSeconds * 1000 + 2001,
    laterAt: baseline.clockPlan.observationSeconds * 1000 + 3001,
    workSeconds: baseline.clockPlan.workSeconds,
    endSeconds: baseline.clockPlan.endSeconds,
  });
}

export const preflightRecordTokenPaths = [
  ["request", "logicalBinding"],
  ["request", "attachReceiptBinding"],
  ["request", "baselineBinding"],
  ["request", "defaultSettingsBinding"],
  ["request", "requestIdentity", "binding"],
  ["attachReceipt", "logicalBinding"],
  ["attachReceipt", "request", "logicalBinding"],
  ["attachReceipt", "request", "requestIdentity", "binding"],
  ["attachReceipt", "binding"],
] as const;

/** Fixed TEST mutation recipe, never a production path/family selector. */
export function replaceRecordToken(record: unknown, index: number) {
  const path = preflightRecordTokenPaths[index];
  if (!path) throw Error("TEST_TOKEN_INDEX");
  const copy = structuredClone(record);
  let node = data(copy);
  for (const key of path.slice(0, -1)) node = data(node[key]);
  const key = path[path.length - 1]!;
  const old = node[key];
  if (typeof old !== "string") throw Error("TEST_TOKEN_PREREQUISITE");
  node[key] = old.slice(0, old.length - 64) + "b".repeat(64);
  return copy;
}
