import {
  chargeAmountToDecimal,
  getChargeCurrencyMetadata,
} from "../../client/charge-currency.js";
import {
  defineUsagePlan,
  parseUsageQuantity,
} from "../../client/usage/contracts.js";
import { scaledUsageRate } from "../../client/usage/catalogMath.js";
import { creditCost } from "../../client/usage/creditTerms.js";
import type {
  UsageConfigurationFields,
  UsageConfigurationValue,
} from "./UsageConfiguration.types.js";
function invalid(message: string): never {
  throw new Error(message);
}
/** Exact major-currency input to the existing decimal minor-unit rate contract. */
function minorRate(price: string, currency: string): string {
  const metadata = getChargeCurrencyMetadata(currency);
  if (!metadata) return invalid("Choose a supported charge currency.");
  if (!/^(0|[1-9]\d{0,13})(\.\d{1,14})?$/.test(price))
    return invalid("Enter a nonnegative decimal price without rounding.");
  const [whole, fraction = ""] = price.split(".");
  const padded = fraction.padEnd(metadata.apiDecimals, "0");
  const integer = BigInt(
    whole + padded.slice(0, metadata.apiDecimals),
  ).toString();
  const decimal = padded.slice(metadata.apiDecimals).replace(/0+$/, "");
  return decimal ? `${integer}.${decimal}` : integer;
}
export function configurationFields(
  value: UsageConfigurationValue,
): UsageConfigurationFields {
  const { plan } = value;
  const metadata = getChargeCurrencyMetadata(plan.rate.currency);
  const [whole, fraction = ""] = plan.rate.unitAmountDecimal.split(".");
  const scale = (metadata?.apiDecimals ?? 0) + fraction.length;
  const digits = (whole + fraction).padStart(scale + 1, "0");
  const integer = BigInt(scale ? digits.slice(0, -scale) : digits).toString();
  const decimal = (scale ? digits.slice(-scale) : "").replace(/0+$/, "");
  const formatted = metadata
    ? integer +
      (decimal ? `.${decimal}` : metadata.displayDecimals ? ".00" : "")
    : "";
  return {
    model: plan.model,
    key: plan.key,
    version: plan.version,
    unit: plan.unit.name,
    precision: String(plan.unit.precision),
    currency: plan.rate.currency,
    price: formatted,
    included:
      plan.model === "included_overage" ? plan.includedQuantity : "1000",
    packageQuantity: value.creditPackage?.quantity ?? "100",
    eventName: value.eventName,
    displayName: value.displayName,
  };
}
export function validateConfiguration(
  fields: UsageConfigurationFields,
  meterId?: string,
): UsageConfigurationValue {
  const precision = Number(fields.precision);
  if (!/^[0-6]$/.test(fields.precision))
    return invalid("Quantity precision must be between 0 and 6.");
  if (
    !fields.key.trim() ||
    fields.key.length > 100 ||
    !fields.version.trim() ||
    fields.version.length > 100
  )
    return invalid(
      "Enter a plan key and a new version, each at most 100 characters.",
    );
  if (!fields.unit.trim() || fields.unit.length > 100)
    return invalid("Enter a billable unit name of at most 100 characters.");
  if (
    !/^[\w.-]{1,100}$/.test(fields.eventName) ||
    !fields.displayName.trim() ||
    fields.displayName.length > 100
  )
    return invalid(
      "Enter a valid meter event name and display name, each at most 100 characters.",
    );
  const currency = fields.currency.toLowerCase();
  const rate = minorRate(fields.price, currency);
  try {
    scaledUsageRate(rate, precision);
  } catch {
    return invalid(
      "The rate exceeds native decimal precision or amount bounds. Change the rate or quantity precision.",
    );
  }
  const common = {
    key: fields.key,
    version: fields.version,
    unit: { name: fields.unit, precision },
    rate: { currency, unitAmountDecimal: rate },
  };
  if (fields.model === "included_overage") {
    try {
      const included = BigInt(
        parseUsageQuantity(fields.included, precision).scaledQuantity,
      );
      if (included < 1n || included > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error();
    } catch {
      return invalid(
        "Included units must be positive, exact at the selected precision and within native tier bounds.",
      );
    }
  }
  const plan = defineUsagePlan(
    fields.model === "included_overage"
      ? {
          ...common,
          model: fields.model,
          includedQuantity: fields.included,
          reset: "billing_period",
        }
      : fields.model === "prepaid"
        ? { ...common, model: fields.model, insufficientBalance: "reject" }
        : { ...common, model: fields.model },
  );
  let creditPackage: UsageConfigurationValue["creditPackage"];
  if (plan.model === "prepaid") {
    try {
      if (chargeAmountToDecimal(creditCost(plan, "1"), currency) === null)
        throw new Error();
      const quantity = parseUsageQuantity(fields.packageQuantity, precision);
      if (
        chargeAmountToDecimal(
          creditCost(plan, quantity.scaledQuantity),
          currency,
        ) === null
      )
        throw new Error();
      creditPackage = { quantity: quantity.quantity, topUp: "manual" };
    } catch {
      return invalid(
        "Paid credits require positive quantities and whole minor currency units for every smallest unit and package, within the native payment bound.",
      );
    }
  }
  return {
    plan,
    eventName: fields.eventName,
    displayName: fields.displayName,
    ...(meterId ? { meterId } : {}),
    ...(creditPackage ? { creditPackage } : {}),
  };
}
