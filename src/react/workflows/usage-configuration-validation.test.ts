import { expect, it } from "vitest";
import {
  configurationFields,
  validateConfiguration,
} from "./usage-configuration-validation.js";
import type { UsageConfigurationValue } from "./UsageConfiguration.types.js";
const original: UsageConfigurationValue = {
  plan: {
    key: "calls",
    version: "v1",
    model: "pay_as_you_go",
    unit: { name: "call", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "2" },
  },
  eventName: "calls_v1",
  displayName: "Calls",
};
it.each([
  ["precision", "1.5"],
  ["precision", "7"],
  ["key", ""],
  ["version", " "],
  ["unit", ""],
  ["eventName", "has spaces"],
  ["displayName", ""],
  ["currency", "bhd"],
  ["currency", "zzz"],
  ["price", "-1"],
  ["price", "1e2"],
  ["price", "0.000000000000001"],
  ["price", "99999999999999"],
  ["model", "unsupported"],
])(
  "rejects invalid %s=%s instead of provisioning or rounding",
  (key, value) => {
    expect(() =>
      validateConfiguration({ ...configurationFields(original), [key]: value }),
    ).toThrow();
  },
);
it("rejects rates that fit the shared contract but exceed native scaled decimal precision", () => {
  expect(() =>
    validateConfiguration({
      ...configurationFields(original),
      precision: "6",
      price: "0.000000001",
    }),
  ).toThrow(/precision/);
});
it.each(["0", "0.001", "9999999999999999999"])(
  "rejects invalid credit package %s",
  (packageQuantity) => {
    expect(() =>
      validateConfiguration({
        ...configurationFields(original),
        model: "prepaid",
        packageQuantity,
      }),
    ).toThrow(/Paid credits/);
  },
);
it("roundtrips fractional zero-decimal currency rates as exact major units", () => {
  const value = {
    ...original,
    plan: {
      ...original.plan,
      rate: { currency: "jpy", unitAmountDecimal: "0.125" },
    },
  };
  const fields = configurationFields(value);
  expect(fields.price).toBe("0.125");
  expect(validateConfiguration(fields)).toEqual(value);
});
it("rejects prepaid packages which violate special currency charge increments", () => {
  expect(() =>
    validateConfiguration({
      ...configurationFields(original),
      currency: "isk",
      price: "0.02",
      model: "prepaid",
      packageQuantity: "1",
    }),
  ).toThrow(/Paid credits/);
});
it.each(["jpy", "usd", "isk"])(
  "preserves large exact native per-unit rates in %s",
  (currency) => {
    const value = {
      ...original,
      plan: {
        ...original.plan,
        rate: { currency, unitAmountDecimal: "999999999999.125" },
      },
    };
    expect(validateConfiguration(configurationFields(value))).toEqual(value);
  },
);
it("allows exact paid packages for fractional rates when consumption uses whole-backed batches", () => {
  const result = validateConfiguration({
    ...configurationFields(original),
    model: "prepaid",
    price: "0.001",
    packageQuantity: "1000",
  });
  expect(result.plan.rate.unitAmountDecimal).toBe("0.1");
  expect(result.creditPackage).toEqual({ quantity: "1000", topUp: "manual" });
});
