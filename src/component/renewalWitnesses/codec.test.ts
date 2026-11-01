import { afterEach, expect, it, vi } from "vitest";
import { canonicalWitnessJSON } from "../../shared/renewalWitness.js";
import { witnessFixture } from "../../../tests/renewalObservation/witnessFixtures.js";
import { canonicalConfigure } from "../renewalOperations/configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
const controls = [
  "unknown-root",
  "subject-empty",
  "negative-time",
  "wall-budget",
  "ns-budget",
  "ns-leading-zero",
  "negative-derived-start",
  "api-version",
  "base-profile",
  "invoice-profile",
  "nodes",
  "depth",
  "aggregate-bytes",
] as const;
it.each(controls)("complete witness codec refuses %s", async (control) => {
  const h = await witnessFixture();
  const value = h.payload;
  if (control === "unknown-root")
    Reflect.set(value, "operationalAuthority", true);
  if (control === "subject-empty") value.capturedSubject = "";
  if (control === "negative-time") value.acquisition.observedAtMs = -1;
  if (control === "wall-budget") value.acquisition.elapsedWallMs = 30000;
  if (control === "ns-budget")
    value.acquisition.elapsedNsDecimal = "30000000000";
  if (control === "ns-leading-zero") value.acquisition.elapsedNsDecimal = "01";
  if (control === "negative-derived-start") {
    value.acquisition.observedAtMs = 1;
    value.acquisition.elapsedWallMs = 2;
  }
  if (control === "api-version") value.acquisition.apiVersion = "other";
  if (control === "base-profile") value.acquisition.baseReadProfile = "other";
  if (control === "invoice-profile")
    Reflect.set(
      value.acquisition,
      "invoiceReadProfile",
      "endive-pinned-invoices-fence-7-v1",
    );
  if (control === "nodes")
    value.reads.schedule.extra = Array.from({ length: 10000 }, () => null);
  if (control === "depth") {
    let nested: unknown = null;
    for (let i = 0; i < 41; i++) nested = { nested };
    value.reads.schedule.extra = nested;
  }
  if (control === "aggregate-bytes") {
    for (const body of [
      value.reads.schedule,
      value.reads.subscription,
      value.reads.targetPrice,
      value.reads.billingCustomer,
    ])
      body.extra = "\u0800".repeat(45000);
  }
  // JSON.stringify intentionally skips the canonical fixture helper so the
  // target, rather than fixture construction, must reject excessive budgets.
  const raw =
    control === "nodes" || control === "depth" || control === "aggregate-bytes"
      ? JSON.stringify(value)
      : canonicalConfigure(value);
  expect(() => canonicalWitnessJSON(raw)).toThrow();
});

it("keeps exact decimal text, unknown nested fields and own null values", async () => {
  const h = await witnessFixture();
  h.payload.reads.targetPrice.extra = {
    amount: "9007199254740991.000000000001",
    nullValue: null,
    list: [null, "retained"],
  };
  const raw = canonicalConfigure(h.payload);
  const captured = canonicalWitnessJSON(raw);
  expect(captured.json).toBe(raw);
  expect(captured.value).toEqual(h.payload);
  expect(
    Reflect.get(captured.value.reads.targetPrice as object, "extra"),
  ).toEqual(h.payload.reads.targetPrice.extra);
});
