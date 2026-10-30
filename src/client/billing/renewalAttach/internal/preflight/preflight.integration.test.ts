import { afterEach, expect, it, vi } from "vitest";
import {
  fixture,
  API_VERSION,
} from "../../../../../../tests/renewalObservation/native-fixture.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
  projectRenewalConfigurationV2,
} from "../../../renewalV2/index.js";
import type { Bundle } from "../material/capture.js";
import type {
  PreflightRecord,
  CurrentEvidence,
  PreflightOutput,
} from "./grammar.js";

afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.resetModules();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function inputs(padding = 0) {
  vi.resetModules();
  const first = 1768867140,
    observed = 1768867200;
  const clock = {
    basis: {
      startWallMs: first * 1000,
      startNs: BigInt(first) * 1000000000n,
      workEndWallMs: (first + 180) * 1000,
      workEndNs: BigInt(first + 180) * 1000000000n,
      endWallMs: (first + 210) * 1000,
      endNs: BigInt(first + 210) * 1000000000n,
    },
    sample: () => ({
      wallMs: observed * 1000 + 1,
      ns: BigInt(observed) * 1000000000n + 1000000n,
    }),
    subscribeRetirement: (_fn: () => void) => () => {},
  };
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => ({
      clock,
      originalPolicy: {
        firstDispatchedAt: first,
        periodStart: 1768435200,
        periodEnd: 1771113600,
      },
      originAssociation: Object.freeze({}),
    }),
  }));
  vi.useFakeTimers();
  vi.setSystemTime(observed * 1000 + 1);
  // Current repository factory supplies raw native bodies only; its V1 claims are ignored.
  // Every new scenario value is declared before the actual V2 subject constructors.
  const f = fixture({ subscription: { trial_start: null, trial_end: null } });
  const subscription = structuredClone(f.subscription),
    targetPrice = structuredClone(f.targetPrice),
    billingCustomer = structuredClone(f.billingCustomer);
  if (padding)
    Object.defineProperty(targetPrice, "opaque", {
      value: "x".repeat(padding),
      enumerable: true,
    });
  const item = subscription.items.data[0];
  const expected = {
    customerAccountId: "acct_buyer",
    subscriptionId: "sub_original",
    itemId: "si_original",
    currentPriceId: "price_original",
    currentProductId: "custom-original",
    targetPriceId: "price_target",
    targetProductId: "custom-target",
    periodStart: 1768435200,
    periodEnd: 1771113600,
    livemode: false,
  };
  const preparation = {
    subscription,
    targetPrice,
    billingCustomer,
    expected,
    key: "renewal:logical-original",
  };
  const prepared = await prepareRenewalPriceReplacementV2(preparation);
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: API_VERSION,
    attachKey: "renewal:attach-original",
    firstDispatchedAt: first,
  });
  const rawAttach = {
    preparation: structuredClone(preparation),
    apiVersion: API_VERSION,
    attachKey: request.key,
    firstDispatchedAt: first,
  };
  const actualDispatch = {
    scope: request.scope,
    apiVersion: request.apiVersion,
    method: request.method,
    path: request.path,
    payload: request.payload,
    key: request.key,
    firstDispatchedAt: request.firstDispatchedAt,
  };
  const rawReceipt = {
    attachRequest: rawAttach,
    actualDispatch,
    providerSnapshot: structuredClone(f.schedule),
  };
  const ack = await constructRenewalScheduleAttachmentReceiptV2(rawReceipt);
  const configuration = {
    preparation,
    attachReceipt: rawReceipt,
    freshSubscription: {
      ...structuredClone(subscription),
      schedule: ack.scheduleId,
    },
    targetPrice: structuredClone(targetPrice),
    billingCustomer: structuredClone(billingCustomer),
    schedule: structuredClone(f.schedule),
    apiVersion: API_VERSION,
    observedAt: observed,
    firstDispatchedAt: observed,
    configureKey: "renewal:configure-original",
  };
  const projected = await projectRenewalConfigurationV2(configuration);
  if (projected.status !== "projected_configure_request")
    throw Error("PUBLIC_C6_FIXTURE_PREREQUISITE");
  const sourceRows = [subscription.discounts, item.discounts],
    coupons = new Map<
      string,
      (typeof subscription.discounts)[number]["source"]["coupon"]
    >();
  for (const list of sourceRows)
    for (const d of list)
      if (!coupons.has(d.source.coupon.id))
        coupons.set(d.source.coupon.id, structuredClone(d.source.coupon));
  const couponReads = [...coupons].map(([couponId, wireCoupon], index) => ({
    couponId,
    wireCoupon,
    association: { resource: "coupon", ordinal: 4 + index },
  }));
  const joins = sourceRows.map((list) =>
    list.map((d, index) => {
      const couponReadIndex = couponReads.findIndex(
        (row) => row.couponId === d.source.coupon.id,
      );
      expect(couponReadIndex).toBeGreaterThanOrEqual(0);
      return {
        index,
        discountId: d.id,
        originalCouponReference: structuredClone(d.source.coupon),
        couponReadIndex,
        joinedDiscount: {
          ...structuredClone(d),
          source: {
            ...structuredClone(d.source),
            coupon: structuredClone(couponReads[couponReadIndex]!.wireCoupon),
          },
        },
      };
    }),
  );
  const originalBundle: Bundle = {
    wireSubscription: structuredClone(subscription),
    wireTargetPrice: structuredClone(targetPrice),
    wireBillingCustomer: structuredClone(billingCustomer),
    couponReads,
    derivedCouponJoins: { subscription: joins[0], item: joins[1] },
  };
  const record: PreflightRecord = {
    configuration,
    request: projected,
    attachReceipt: ack,
    originalBundle,
  };
  const evidence: CurrentEvidence = {
    bundle: {
      ...structuredClone(originalBundle),
      wireSubscription: structuredClone(configuration.freshSubscription),
    },
    schedule: structuredClone(configuration.schedule),
    observedAt: observed,
  };
  const capture = await import("./record.js"),
    relations = await import("./relations.js"),
    output = await import("./output.js");
  return { record, evidence, projected, ack, capture, relations, output };
}
function metrics(value: unknown) {
  let nodes = 0,
    depth = 0;
  const active = new Set<object>();
  function visit(x: unknown, d: number) {
    nodes++;
    depth = Math.max(depth, d);
    if (x && typeof x === "object") {
      if (active.has(x)) throw Error("TEST_CYCLE");
      active.add(x);
      for (const y of Object.values(x)) visit(y, d + 1);
      active.delete(x);
    }
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  return {
    chars: text.length,
    bytes: new TextEncoder().encode(text).length,
    nodes,
    depth,
  };
}
it("reconstructs the complete four-field record and releases only the full fourteen-slot DATA wrapper", async () => {
  const f = await inputs();
  const captured = f.capture.capturePreflightRecord(f.record);
  const record = f.relations.verifyPreflightRecord(
    captured,
    f.projected,
    f.ack,
  );
  f.relations.verifyCurrentPreflight(record, f.evidence);
  const out = f.output.releasePreflight(
    record,
    f.evidence,
    f.projected,
    f.projected,
    f.ack,
  );
  expect(out).toEqual({
    status: "configure_preflight_consistent",
    originalRecord: f.record,
    currentEvidence: f.evidence,
    request: f.projected,
    operationalAuthority: false,
  });
  expect(Object.isFrozen(out)).toBe(true);
  const m = metrics(out);
  expect(m.bytes).toBeLessThanOrEqual(500000);
  expect(m.nodes).toBeLessThanOrEqual(10000);
  expect(m.depth).toBeLessThanOrEqual(40);
});
it("refuses every generated value tamper and extra control data", async () => {
  const f = await inputs();
  const { outputFamilies } = await import("./grammar.js");
  for (const path of Object.keys(outputFamilies)) {
    const record = structuredClone(f.record),
      request = structuredClone(f.projected);
    const root: Record<string, unknown> = { originalRecord: record, request };
    let cursor = root;
    const keys = path.slice(1).split("/");
    for (const key of keys.slice(0, -1))
      cursor = cursor[key] as Record<string, unknown>;
    const key = keys[keys.length - 1]!;
    const old = cursor[key];
    expect(typeof old).toBe("string");
    cursor[key] =
      String(old).slice(0, -1) + (String(old).endsWith("a") ? "b" : "a");
    expect(() =>
      f.output.releasePreflight(
        record,
        f.evidence,
        request,
        f.projected,
        f.ack,
      ),
    ).toThrow();
  }
  expect(() =>
    f.capture.capturePreflightRecord({ ...f.record, extra: true }),
  ).toThrow();
});
it("preserves an ordinary digest-looking raw string while rejecting the unchanged bounded digit pattern", async () => {
  const f = await inputs();
  const ordinary = "renewal:v2:sha256:" + "1".repeat(64),
    raw = structuredClone(f.record);
  Object.defineProperty(raw.configuration.targetPrice as object, "opaque", {
    value: ordinary,
    enumerable: true,
  });
  const admitted = f.capture.capturePreflightRecord(raw);
  expect(
    Object.getOwnPropertyDescriptor(
      admitted.configuration.targetPrice as object,
      "opaque",
    )?.value,
  ).toBe(ordinary);
  const bad = structuredClone(f.record);
  Object.defineProperty(bad.configuration.targetPrice as object, "opaque", {
    value:
      "renewal:v2:sha256:" + "a".repeat(25) + "1".repeat(13) + "b".repeat(26),
    enumerable: true,
  });
  expect(() => f.capture.capturePreflightRecord(bad)).toThrow();
});
it("refuses complete current Schedule and body drift without using a selected-view comparison", async () => {
  const f = await inputs();
  const record = f.relations.verifyPreflightRecord(
    f.capture.capturePreflightRecord(f.record),
    f.projected,
    f.ack,
  );
  const schedule = structuredClone(f.evidence);
  schedule.schedule.opaque = "current-only";
  expect(() => f.relations.verifyCurrentPreflight(record, schedule)).toThrow();
  for (const key of [
    "wireSubscription",
    "wireTargetPrice",
    "wireBillingCustomer",
  ] as const) {
    const evidence = structuredClone(f.evidence);
    Object.defineProperty(evidence.bundle[key], "opaque", {
      value: "current-only",
      enumerable: true,
    });
    expect(() =>
      f.relations.verifyCurrentPreflight(record, evidence),
    ).toThrow();
  }
});
it("isolates output overflow after earlier fits and entry into the actual release function", async () => {
  const f = await inputs(115000);
  const captured = f.capture.capturePreflightRecord(f.record),
    record = f.relations.verifyPreflightRecord(captured, f.projected, f.ack);
  f.relations.verifyCurrentPreflight(record, f.evidence);
  for (const component of [f.record, f.evidence, f.projected, f.ack]) {
    const m = metrics(component);
    expect(m.bytes).toBeLessThanOrEqual(500000);
    expect(m.nodes).toBeLessThanOrEqual(10000);
    expect(m.depth).toBeLessThanOrEqual(40);
  }
  const expected: PreflightOutput = {
    status: "configure_preflight_consistent",
    originalRecord: f.record,
    currentEvidence: f.evidence,
    request: f.projected,
    operationalAuthority: false,
  };
  expect(metrics(expected).bytes).toBeGreaterThan(500000);
  let releaseEntries = 0;
  const actual = f.output.releasePreflight;
  const release = (...args: Parameters<typeof actual>) => {
    releaseEntries++;
    return Reflect.apply(actual, f.output, args);
  };
  expect(() =>
    release(record, f.evidence, f.projected, f.projected, f.ack),
  ).toThrow("MATERIAL_V2_UNSUPPORTED");
  expect(releaseEntries).toBe(1);
});
