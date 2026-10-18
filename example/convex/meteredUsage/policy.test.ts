import { expect, it } from "vitest";
import * as policy from "./policy";
it("defines repeatable package configurations for all three native models", () => {
  expect(policy.demoConfiguration).toBeTypeOf("function");
  const models = ["pay_as_you_go", "included_overage", "prepaid"] as const;
  for (const model of models) {
    const value = policy.demoConfiguration(model);
    expect(value.plan.model).toBe(model);
    expect(value.plan.rate).toEqual({
      currency: "usd",
      unitAmountDecimal: "100",
    });
    expect(policy.demoConfiguration(model)).toEqual(value);
  }
  expect(policy.demoConfiguration("included_overage").plan).toMatchObject({
    includedQuantity: "10",
    reset: "billing_period",
  });
  expect(policy.demoConfiguration("prepaid").creditPackage).toEqual({
    quantity: "10",
    topUp: "manual",
  });
});
it("namespaces original native plan and event identities by durable server fixture, never client ownership", () => {
  expect(policy.nativeDemoConfiguration).toBeTypeOf("function");
  const value = policy.demoConfiguration("pay_as_you_go");
  const first = policy.nativeDemoConfiguration(value, "runA");
  const second = policy.nativeDemoConfiguration(value, "runB");
  expect(first.plan.key).not.toBe(second.plan.key);
  expect(first.eventName).not.toBe(second.eventName);
  expect(first.plan.unit).toEqual(value.plan.unit);
  expect(first.plan.rate).toEqual(value.plan.rate);
  expect(policy.nativeDemoConfiguration(value, "runA")).toEqual(first);
});
it("rejects model changes and malformed demo configuration instead of adopting a different billing scope", () => {
  expect(policy.parseDemoConfiguration).toBeTypeOf("function");
  const value = policy.demoConfiguration("prepaid");
  expect(() =>
    policy.parseDemoConfiguration(JSON.stringify(value), "pay_as_you_go"),
  ).toThrow();
  expect(() =>
    policy.parseDemoConfiguration('{"plan":{}}', "pay_as_you_go"),
  ).toThrow();
  expect(() =>
    policy.parseDemoConfiguration(
      JSON.stringify({ ...value, ownership: "seller" }),
      "prepaid",
    ),
  ).toThrow();
  expect(
    policy.parseDemoConfiguration(JSON.stringify(value), "prepaid"),
  ).toEqual(value);
});
it("keeps missing native observations unavailable instead of implying zero or paid outcomes", () => {
  expect(policy.demoObservationUnavailable).toBeTypeOf("function");
  expect(policy.demoObservationUnavailable()).toEqual({
    status: "unavailable",
    reason: "not_observed",
    retryable: true,
  });
});
it("assigns new synthetic events the retained native fixture clock, never rewrites original attempts", () => {
  expect(policy.demoWorkTimestamp).toBeTypeOf("function");
  expect(
    policy.demoWorkTimestamp(
      JSON.stringify({ meter: { subscription: { period: { start: 600 } } } }),
      900,
    ),
  ).toBe(600);
  expect(policy.demoWorkTimestamp(undefined, 900)).toBe(900);
  expect(() =>
    policy.demoWorkTimestamp(
      JSON.stringify({ meter: { subscription: { period: { start: 1201 } } } }),
      900,
    ),
  ).toThrow(/clock/);
});
