import { projectRenewalConfigurationV2 } from "./index.js";
import { it, expect } from "vitest";
import * as sdk from "./observation.js";
import { observationInput } from "../../../../tests/renewalObservation/fixtures.js";
const inspect = (raw: unknown) => {
  expect((sdk as any).inspectRenewalScheduleMaterialV2).toBeTypeOf("function");
  return (sdk as any).inspectRenewalScheduleMaterialV2(raw);
};
it("matches full classic changed-cadence weekly pending material without a configure ACK", async () => {
  const raw = observationInput();
  const before = structuredClone(raw);
  const r = await inspect(raw);
  expect(r).toMatchObject({
    predicate: "pending_material_match",
    acknowledgementEstablished: false,
    authenticationEstablished: false,
    providerQualificationRequired: true,
  });
  expect(raw).toEqual(before);
  expect(raw.configuration.preparation.subscription).toHaveProperty(
    "latest_invoice",
    "in_original",
  );
});
it("matches a unique full native active item only when the retained invoice pointer is coherent", async () => {
  const raw = observationInput(true);
  expect(raw.reads.subscription.latest_invoice).toBe("in_original");
  expect(raw.reads.subscription.items.data[0].plan.object).toBe("plan");
  expect(await inspect(raw)).toMatchObject({
    predicate: "current_target_material_match",
    observedItemId: "si_successor",
  });
});
it("keeps I0 to I1 native invoice-pointer changes conflicting instead of dropping required material", async () => {
  const raw = observationInput(true);
  raw.reads.subscription.latest_invoice = "in_successor";
  expect(raw.configuration.preparation.subscription.latest_invoice).toBe(
    "in_original",
  );
  expect(await inspect(raw)).toMatchObject({
    predicate: "conflict",
    reason: "effective_full_material_drift",
  });
});

it("keeps an unproved monthly pending duration unknown without treating reads as an ACK", async () => {
  expect(await inspect(observationInput(false, false))).toMatchObject({
    predicate: "unknown",
    reason: "future_duration_not_bound",
    acknowledgementEstablished: false,
  });
});
it.each([-1, 1, 604800])(
  "rejects a full weekly future phase whose end differs by %i seconds",
  async (delta) => {
    const raw = observationInput();
    raw.reads.schedule.phases[1].end_date += delta;
    expect(await inspect(raw)).toMatchObject({
      predicate: "conflict",
      reason: "target_phase_duration_mismatch",
    });
  },
);
it("does not use the weekly rule for flexible material", async () => {
  const raw = observationInput();
  const mode = {
    type: "flexible",
    flexible: { proration_discounts: "included" },
  };
  for (const sub of [
    raw.configuration.preparation.subscription,
    raw.configuration.attachReceipt.attachRequest.preparation.subscription,
    raw.configuration.freshSubscription,
    raw.reads.subscription,
  ])
    Object.assign(sub, { billing_mode: mode });
  for (const schedule of [
    raw.configuration.schedule,
    raw.configuration.attachReceipt.providerSnapshot,
    raw.reads.schedule,
  ])
    Object.assign(schedule, { billing_mode: mode });
  expect(await inspect(raw)).toMatchObject({
    predicate: "unknown",
    reason: "future_duration_not_bound",
  });
});
it("does not omit latest_invoice to manufacture a full native positive", async () => {
  const raw = observationInput(true);
  delete (raw.reads.subscription as Record<string, unknown>).latest_invoice;
  expect(await inspect(raw)).toMatchObject({
    predicate: "unknown",
    reason: "missing_latest_invoice",
  });
});
it("retains canceled terminal facts without assigning effectiveness", async () => {
  const raw = observationInput();
  raw.reads.schedule.status = "canceled";
  expect(await inspect(raw)).toMatchObject({
    predicate: "terminal_facts_only",
    effectiveness: "unknown",
  });
});
it.each(["prototype", "getter", "symbol", "hidden"])(
  "rejects non-JSON %s roots before invoking a getter",
  async (kind) => {
    const raw: any = observationInput();
    let calls = 0;
    if (kind === "prototype") Object.setPrototypeOf(raw, { custom: true });
    if (kind === "getter")
      Object.defineProperty(raw, "reads", {
        enumerable: true,
        get() {
          calls++;
          throw Error("private");
        },
      });
    if (kind === "symbol") raw[Symbol("private")] = true;
    if (kind === "hidden")
      Object.defineProperty(raw, "hidden", { value: "private" });
    await expect(inspect(raw)).rejects.toThrow(
      "Invalid raw renewal observation",
    );
    expect(calls).toBe(0);
  },
);
it("rejects nested hidden SDK response metadata instead of stripping it", async () => {
  const raw = observationInput();
  let calls = 0;
  Object.defineProperty(raw.reads.schedule, "lastResponse", {
    get() {
      calls++;
      throw Error("private");
    },
  });
  await expect(inspect(raw)).rejects.toThrow("Invalid raw renewal observation");
  expect(calls).toBe(0);
});
it("captures reads before asynchronous digest work", async () => {
  const raw = observationInput(true);
  const pending = inspect(raw);
  raw.reads.subscription.latest_invoice = "in_mutated";
  raw.reads.schedule.phases[1].end_date++;
  expect(await pending).toMatchObject({
    predicate: "current_target_material_match",
  });
});
it("retains unknown own special fields in the full subscription comparison", async () => {
  const raw = observationInput(true);
  Object.defineProperty(raw.reads.subscription, "__proto__", {
    value: { retained: true },
    enumerable: true,
  });
  expect(await inspect(raw)).toMatchObject({
    predicate: "conflict",
    reason: "effective_full_material_drift",
  });
});
it("rejects the new API's whole input byte/node bounds", async () => {
  const raw: any = observationInput();
  raw.reads.subscription.extra = "🧪".repeat(130000);
  await expect(inspect(raw)).rejects.toThrow();
  const nodes: any = observationInput();
  nodes.reads.subscription.extra = Array.from({ length: 10001 }, () => null);
  await expect(inspect(nodes)).rejects.toThrow();
});

async function withReceipt(active = false, weekly = false) {
  const raw: any = observationInput(active, weekly),
    baseline = observationInput(false, weekly);
  const request = await projectRenewalConfigurationV2(raw.configuration);
  if (request.status !== "projected_configure_request") throw Error("fixture");
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  raw.configureReceipt = {
    configuration: structuredClone(raw.configuration),
    actualDispatch: {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    },
    providerSnapshot: baseline.reads.schedule,
    transport: { status: 200, requestId: "req_material" },
  };
  return raw;
}
it("uses complete raw C9 historical material for monthly pending without authenticating it", async () => {
  expect(await inspect(await withReceipt())).toMatchObject({
    predicate: "pending_material_match",
    acknowledgementEstablished: false,
    authenticationEstablished: false,
  });
});
it("does not let a C9 receipt authorize a new native invoice pointer", async () => {
  const raw = await withReceipt(true);
  raw.reads.subscription.latest_invoice = "in_successor";
  expect(await inspect(raw)).toMatchObject({
    predicate: "conflict",
    reason: "effective_full_material_drift",
  });
});
it("rejects differing repeated raw C9 configuration", async () => {
  const raw = await withReceipt();
  raw.configureReceipt.configuration.configureKey = "different";
  expect(await inspect(raw)).toMatchObject({
    predicate: "conflict",
    reason: "invalid_repeated_configuration",
  });
});
it.each([
  "scope",
  "apiVersion",
  "method",
  "path",
  "payload",
  "key",
  "firstDispatchedAt",
])("never trusts a tampered raw C9 dispatch %s", async (field) => {
  const raw = await withReceipt();
  raw.configureReceipt.actualDispatch[field] =
    field === "payload" ? {} : field === "firstDispatchedAt" ? 1 : "foreign";
  if (field === "scope" || field === "method")
    await expect(inspect(raw)).rejects.toThrow(
      "Invalid raw renewal observation.",
    );
  else
    expect(await inspect(raw)).toMatchObject({
      predicate: "unknown",
      reason: "incomplete_or_unsupported_schema",
    });
});
it("captures repeated C9 input before any asynchronous digest", async () => {
  const raw = await withReceipt();
  const pending = inspect(raw);
  raw.configureReceipt.configuration.configureKey = "changed_after_capture";
  expect(await pending).toMatchObject({ predicate: "pending_material_match" });
});
it("does not create a native positive by omitting both original and current invoice pointers", async () => {
  const raw: any = observationInput(true);
  for (const sub of [
    raw.configuration.preparation.subscription,
    raw.configuration.attachReceipt.attachRequest.preparation.subscription,
    raw.configuration.freshSubscription,
    raw.reads.subscription,
  ])
    delete sub.latest_invoice;
  expect(await inspect(raw)).toMatchObject({
    predicate: "unknown",
    reason: "missing_latest_invoice",
  });
});
it("rejects metadata introduced by descriptor reflection after the own-key snapshot", async () => {
  const raw: any = observationInput(true),
    target = raw.reads.subscription;
  let introduced = false;
  raw.reads.subscription = new Proxy(target, {
    getOwnPropertyDescriptor(t, key) {
      const d = Reflect.getOwnPropertyDescriptor(t, key);
      if (key === "items" && !introduced) {
        introduced = true;
        Object.defineProperty(t, "lastResponse", {
          value: { statusCode: 200 },
          configurable: true,
        });
      }
      return d;
    },
  });
  await expect(inspect(raw)).rejects.toThrow(
    "Invalid raw renewal observation.",
  );
  expect(introduced).toBe(true);
});

it("keeps multi-week pending duration unsupported without C9 baseline evidence", async () => {
  expect(await inspect(observationInput(false, true, 2))).toMatchObject({
    predicate: "unknown",
    reason: "future_duration_not_bound",
  });
});
it("retains paid settings and full Customer/Coupon unknown material despite a correct weekly end", async () => {
  for (const change of [
    (x: any) => {
      x.reads.billingCustomer.new_unknown = "drift";
    },
    (x: any) => {
      x.reads.coupons[0].times_redeemed++;
    },
    (x: any) => {
      x.reads.subscription.items.data[0].plan.nickname = "drift";
    },
    (x: any) => {
      x.reads.subscription.metadata.keep = "drift";
    },
  ]) {
    const raw = observationInput();
    change(raw);
    expect((await inspect(raw)).predicate).not.toBe("pending_material_match");
  }
});
it("accepts plain null-prototype and benign Proxy roots without evaluating caller code", async () => {
  const raw = observationInput(true);
  const nullRoot = Object.assign(Object.create(null), raw);
  expect(await inspect(nullRoot)).toMatchObject({
    predicate: "current_target_material_match",
  });
  let prototypes = 0;
  const proxy = new Proxy(raw, {
    getPrototypeOf(t) {
      prototypes++;
      return Reflect.getPrototypeOf(t);
    },
  });
  expect(await inspect(proxy)).toMatchObject({
    predicate: "current_target_material_match",
  });
  expect(prototypes).toBe(1);
});
it("rejects a nested toJSON function without calling it", async () => {
  const raw: any = observationInput();
  let calls = 0;
  raw.reads.subscription.toJSON = () => {
    calls++;
    throw Error("private");
  };
  await expect(inspect(raw)).rejects.toThrow(
    "Invalid raw renewal observation.",
  );
  expect(calls).toBe(0);
});
