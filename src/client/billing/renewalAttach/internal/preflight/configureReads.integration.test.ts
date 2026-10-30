import { afterEach, expect, it, vi } from "vitest";
import {
  configureReadOperationFixture,
  configureReadMetrics,
} from "../test-fixtures/configureReadOperation.js";

afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.doUnmock("../acquisition/readLifetime.js");
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("configure read profile retains the complete Schedule before its single child finish", async () => {
  vi.resetModules();
  const h = await configureReadOperationFixture();
  const { bindConfigureReadAcquisitionFromSource } =
    await import("../acquisition/ownedAcquisition.js");
  const originalBasis = h.OWNER.basis;
  h.OWNER.check();
  const reader = bindConfigureReadAcquisitionFromSource(
    h.OWNER,
    h.transport,
    h.scope,
  );
  const result = await reader.acquire();
  const later = h.OWNER.check();
  expect(result.ok).toBe(true);
  if (result.ok !== true) throw Error("READ_PROFILE_PREREQUISITE");
  expect(result.dataOnly).toBe(true);
  expect(result.bundle).toEqual(h.expectedBundle);
  expect(result.sourceFulfillmentEstablished).toBe(false);
  expect(result.clockProvenanceEstablished).toBe(false);
  expect(result.operatorReady).toBe(false);
  expect(h.OWNER.basis).toBe(originalBasis);
  expect(later.retired).toBe(false);
  expect(h.counts()).toEqual({
    children: 1,
    begins: 1,
    finishes: 1,
    failures: 0,
  });
  expect(h.httpCalls.length).toBeGreaterThanOrEqual(5);
  expect(h.httpCalls.length).toBeLessThanOrEqual(6);
  expect(h.httpCalls.slice(0, 5)).toEqual(
    h.paths.slice(0, 5).map((path) => ({
      url: "https://api.stripe.com" + path,
      method: "GET",
      redirect: "error",
    })),
  );
  expect(h.mechanics.slice(0, 5).map((x) => x.path)).toEqual(
    h.paths.slice(0, 5),
  );
  for (const call of h.mechanics) {
    expect(call.method).toBe("GET");
    expect(call.body).toBe(undefined);
    expect(call.options).toEqual({
      apiVersion: "2026-09-30.endive",
      maxNetworkRetries: 0,
    });
    expect(h.paths.includes(call.path)).toBe(true);
  }
  const rawSchedule: unknown = Object.getOwnPropertyDescriptor(
    result,
    "schedule",
  )?.value;
  console.log(
    JSON.stringify({
      kind: "CONFIGURE_READ_PROFILE_PREREQUISITES",
      actualHTTPGETs: h.httpCalls.length,
      childBegins: h.counts().begins,
      childFinishes: h.counts().finishes,
      schedulePresent: rawSchedule !== undefined,
      bundleMetrics: configureReadMetrics(result.bundle),
      actualPOSTs: h.mechanics.filter((x) => x.method !== "GET").length,
      receiptCustodyEstablished: false,
    }),
  );

  // Sole intended RED target. The current completed43 reader has no Schedule field.
  expect(rawSchedule).toEqual(h.schedule);

  // These unchanged assertions must all pass after the separately scoped real44 implementation.
  expect(Object.keys(result).sort()).toEqual(
    [
      "ok",
      "dataOnly",
      "bundle",
      "schedule",
      "observedAt",
      "sourceFulfillmentEstablished",
      "clockProvenanceEstablished",
      "operatorReady",
    ].sort(),
  );
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(rawSchedule)).toBe(true);
  expect(h.httpCalls).toEqual(
    h.paths.map((path) => ({
      url: "https://api.stripe.com" + path,
      method: "GET",
      redirect: "error",
    })),
  );
  expect(h.mechanics).toHaveLength(6);
  const schedulePath = h.paths[h.paths.length - 1]!;
  const scheduleRequest = h.events.findIndex(
    (x) => x.kind === "request" && x.path === schedulePath,
  );
  const scheduleReply = h.events.findIndex(
    (x) => x.kind === "reply" && x.path === schedulePath,
  );
  const finish = h.events.findIndex((x) => x.kind === "finish");
  expect(scheduleRequest).toBeGreaterThanOrEqual(0);
  expect(scheduleReply).toBeGreaterThan(scheduleRequest);
  expect(finish).toBeGreaterThan(scheduleReply);
  expect(h.events.filter((x) => x.kind === "create")).toHaveLength(1);
  expect(h.events.filter((x) => x.kind === "finish")).toHaveLength(1);
  expect(h.events.every((x) => x.child === 1)).toBe(true);
  expect(result.observedAt).toBe(Math.floor(h.scheduleAt / 1000));
  expect(result.observedAt).not.toBe(Math.floor(h.baseAt / 1000));
  expect(later.wallMs).toBe(h.laterAt);
  expect(result.observedAt).not.toBe(later.nowSeconds);
  const m = configureReadMetrics(result);
  expect(m.chars).toBeLessThanOrEqual(500000);
  expect(m.bytes).toBeLessThanOrEqual(500000);
  expect(m.nodes).toBeLessThanOrEqual(10000);
  expect(m.depth).toBeLessThanOrEqual(40);
  expect(await reader.acquire()).toEqual({
    ok: false,
    complete: false,
    code: "RAW_ACQUISITION_STOP",
  });
  expect(h.httpCalls).toHaveLength(6);
  expect(h.OWNER.basis).toBe(originalBasis);
  expect(h.OWNER.check().retired).toBe(false);
});
