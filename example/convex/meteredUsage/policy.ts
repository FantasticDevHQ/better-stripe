import {
  defineUsagePlan,
  parseUsageQuantity,
  type UsageBillingModel,
  type UsageAvailability,
  type UsageConfigurationValue,
} from "@fantastic.dev/better-stripe/usage";
/** Business-specific sandbox defaults. All accounting remains in the package. */
export function demoConfiguration(
  model: UsageBillingModel,
): UsageConfigurationValue {
  const common = {
    key: "api-calls",
    version: "v1",
    unit: { name: "call", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "100" },
  };
  const plan = defineUsagePlan(
    model === "included_overage"
      ? { ...common, model, includedQuantity: "10", reset: "billing_period" }
      : model === "prepaid"
        ? { ...common, model, insufficientBalance: "reject" }
        : { ...common, model },
  );
  return {
    plan,
    eventName: "api_calls_v1",
    displayName: "API calls",
    ...(model === "prepaid"
      ? { creditPackage: { quantity: "10", topUp: "manual" } }
      : {}),
  };
}
export function parseDemoConfiguration(
  json: string,
  model: UsageBillingModel,
): UsageConfigurationValue {
  try {
    const value = JSON.parse(json);
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).some(
        (key) =>
          !["plan", "eventName", "displayName", "creditPackage"].includes(key),
      )
    )
      throw new Error();
    const plan = defineUsagePlan(value.plan);
    if (
      plan.model !== model ||
      typeof value.eventName !== "string" ||
      !/^[\w.-]{1,100}$/.test(value.eventName) ||
      typeof value.displayName !== "string" ||
      !value.displayName.trim() ||
      value.displayName.length > 100
    )
      throw new Error();
    let creditPackage: UsageConfigurationValue["creditPackage"];
    if (model === "prepaid") {
      const pkg = value.creditPackage;
      if (
        !pkg ||
        Object.keys(pkg).some((key) => !["quantity", "topUp"].includes(key)) ||
        pkg.topUp !== "manual"
      )
        throw new Error();
      const quantity = parseUsageQuantity(pkg.quantity, plan.unit.precision);
      if (quantity.scaledQuantity === "0") throw new Error();
      creditPackage = { quantity: quantity.quantity, topUp: "manual" };
    } else if (value.creditPackage !== undefined) throw new Error();
    return {
      plan,
      eventName: value.eventName,
      displayName: value.displayName,
      ...(creditPackage ? { creditPackage } : {}),
    };
  } catch {
    throw new Error("Unsupported or malformed sandbox model configuration.");
  }
}
/** Keep separate demo actors/runs out of one another's native catalog identities. */
export function nativeDemoConfiguration(
  value: UsageConfigurationValue,
  runId: string,
): UsageConfigurationValue {
  return {
    ...value,
    plan: defineUsagePlan({
      ...value.plan,
      key: `demo_${runId}_${value.plan.key}`.slice(0, 100),
    }),
    eventName: `bs_${runId}_${value.eventName}`.slice(0, 100),
  };
}
export function demoObservationUnavailable<T>(): UsageAvailability<T> {
  return { status: "unavailable", reason: "not_observed", retryable: true };
}
/** Synthetic sandbox activity follows the fixture's frozen clock. Production work uses its true source timestamp. */
export function demoWorkTimestamp(
  providerJson: string | undefined,
  now: number,
): number {
  if (!providerJson) return now;
  try {
    const value = JSON.parse(providerJson)?.meter?.subscription?.period?.start;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > now + 300 ||
      value < now - 35 * 86400
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      "The original sandbox clock is unavailable or outside the permitted event window.",
    );
  }
}
