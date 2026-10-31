import { afterEach, expect, it, vi } from "vitest";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import { object } from "./common.js";
import {
  recipe,
  set,
  model,
  unknownResult,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";

afterEach(() => vi.unstubAllGlobals());
/** Reflection only: do not invoke getters or serialize malformed/cyclic DATA. */
function descriptors(input: unknown) {
  const seen = new Set<object>();
  const rows: {
    object: object;
    key: PropertyKey;
    descriptor: PropertyDescriptor;
  }[] = [];
  function walk(value: unknown) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw Error("MISSING_TEST_DESCRIPTOR");
      rows.push({ object: value, key, descriptor });
      if ("value" in descriptor) walk(descriptor.value);
    }
  }
  walk(input);
  return rows;
}
const malformed = [
  "missing-root",
  "extra-root",
  "undefined",
  "symbol",
  "hidden",
  "getter",
  "cycle",
  "nonfinite",
  "sparse",
  "prototype",
] as const;
it.each(malformed)(
  "evidence admission rejects %s without reading getters",
  async (control) => {
    const input = recipe().input;
    const schedule = object(input.reads.schedule);
    let getterCalls = 0,
      fetchCalls = 0;
    if (control === "missing-root") Reflect.deleteProperty(input, "reads");
    if (control === "extra-root") set(input, "extra", null);
    if (control === "undefined") set(schedule, "unknown", undefined);
    if (control === "symbol")
      set(schedule, "unknown", { [Symbol("TEST")]: true });
    if (control === "hidden")
      Object.defineProperty(schedule, "unknown", { value: null });
    if (control === "getter")
      Object.defineProperty(schedule, "unknown", {
        enumerable: true,
        get() {
          getterCalls++;
          return null;
        },
      });
    if (control === "cycle") set(schedule, "unknown", schedule);
    if (control === "nonfinite") set(schedule, "unknown", Number.NaN);
    if (control === "sparse") set(schedule, "unknown", new Array(1));
    if (control === "prototype") set(schedule, "unknown", new Date(0));
    const before = descriptors(input);
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw Error("UNEXPECTED_FETCH");
    });
    let targetFailed = false;
    try {
      await expect(inspectRenewalEvidenceV1(input)).rejects.toThrow(
        /^Invalid raw renewal evidence\.$/,
      );
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(descriptors(input)).toEqual(before);
        expect(getterCalls).toBe(0);
        expect(fetchCalls).toBe(0);
      } catch (error) {
        if (!targetFailed) throw error;
        console.info("EVIDENCE_ADMISSION_INSPECTION_FAILED");
      }
    }
  },
);
it.each(["version", "api"] as const)(
  "evidence unsupported %s returns the entire closed DTO",
  async (control) => {
    const input = recipe().input;
    set(
      input,
      control === "version" ? "version" : "apiVersion",
      control === "version" ? 2 : "2026-01-28.clover",
    );
    const before = structuredClone(input);
    const expected = unknownResult(
      control === "version" ? "unsupported_profile" : "unsupported_api_version",
    );
    let fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw Error("UNEXPECTED_FETCH");
    });
    let targetFailed = false;
    try {
      const actual = await inspectRenewalEvidenceV1(input);
      expect(actual).toEqual(expected);
      expect(Reflect.ownKeys(actual)).toHaveLength(12);
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(input).toEqual(before);
        expect(fetchCalls).toBe(0);
      } catch (error) {
        if (!targetFailed) throw error;
        console.info("EVIDENCE_ADMISSION_INSPECTION_FAILED");
      }
    }
  },
);
const boundaries = [
  "characters-under",
  "characters-over",
  "utf8-over",
  "nodes-under",
  "nodes-over",
  "depth-under",
  "depth-over",
] as const;
it.each(boundaries)("evidence whole-model boundary %s", async (control) => {
  const input = recipe().input;
  // Unsupported version isolates whole-input admission from material predicates.
  set(input, "version", 2);
  const schedule = object(input.reads.schedule);
  set(schedule, "unknown", "");
  if (control.startsWith("characters")) {
    const remaining = 500000 - model(input).characters;
    expect(remaining).toBeGreaterThan(0);
    set(
      schedule,
      "unknown",
      "x".repeat(remaining + (control.endsWith("over") ? 1 : 0)),
    );
  } else if (control === "utf8-over") {
    set(schedule, "unknown", "é".repeat(260000));
  } else if (control.startsWith("nodes")) {
    set(schedule, "unknown", []);
    const remaining = 10000 - model(input).nodes;
    expect(remaining).toBeGreaterThan(0);
    set(
      schedule,
      "unknown",
      Array.from(
        { length: remaining + (control.endsWith("over") ? 1 : 0) },
        () => null,
      ),
    );
  } else {
    let nested: unknown = null;
    for (let i = 0; i < (control.endsWith("over") ? 38 : 37); i++)
      nested = { next: nested };
    set(schedule, "unknown", nested);
  }
  const metrics = model(input);
  const over = control.endsWith("over");
  if (control.startsWith("characters"))
    expect(metrics.characters).toBe(over ? 500001 : 500000);
  if (control === "utf8-over") {
    expect(metrics.characters).toBeLessThan(500000);
    expect(metrics.bytes).toBeGreaterThan(500000);
  }
  if (control.startsWith("nodes"))
    expect(metrics.nodes).toBe(over ? 10001 : 10000);
  if (control.startsWith("depth")) expect(metrics.depth).toBe(over ? 41 : 40);
  const before = descriptors(input);
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_FETCH");
  });
  let targetFailed = false;
  try {
    if (over)
      await expect(inspectRenewalEvidenceV1(input)).rejects.toThrow(
        /^Invalid raw renewal evidence\.$/,
      );
    else
      expect(await inspectRenewalEvidenceV1(input)).toEqual(
        unknownResult("unsupported_profile"),
      );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(descriptors(input)).toEqual(before);
      expect(fetchCalls).toBe(0);
      console.info(
        "EVIDENCE_ADMISSION_BOUNDARY",
        JSON.stringify({ control, ...metrics, fetchCalls }),
      );
    } catch (error) {
      if (!targetFailed) throw error;
      console.info("EVIDENCE_ADMISSION_INSPECTION_FAILED");
    }
  }
});
