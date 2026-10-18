import { expect, it } from "vitest";
import type { UsageComparison } from "@fantastic.dev/better-stripe/usage";
import { usageSnapshot } from "../../../src/react/workflows/Usage.fixtures.js";
import * as guard from "./billingGuard";
function ready() {
  const snapshot = usageSnapshot("5");
  const local =
    snapshot.summary.status === "available" ? snapshot.summary.value : null!;
  const group = local.groups[0];
  group.deliveryQuantities.unknown = "0";
  group.deliveryQuantities.provider_accepted = "5";
  group.providerAcceptedScaledQuantity = group.effectiveScaledQuantity;
  group.providerAcceptedQuantity = "5";
  return {
    local,
    comparison: {
      status: "observed_match" as UsageComparison["status"],
      reason: "observations_equal",
      localAcceptedQuantity: "5",
      providerAcceptedQuantity: "5",
      providerAggregateQuantity: "5",
    },
    reservedQuantity: "0",
    corrections: {
      isDone: true,
      legacyHistoryMissing: false,
      records: [] as Array<{ key: string; sequence: number; state: string }>,
    },
  };
}
it("permits a drained exact package/native match and a confirmed correction", () => {
  expect(guard.assertDemoBillingReady).toBeTypeOf("function");
  const input = ready();
  input.corrections.records = [
    { key: "c", sequence: 1, state: "requested" },
    { key: "c", sequence: 2, state: "confirmed" },
  ];
  expect(() => guard.assertDemoBillingReady(input)).not.toThrow();
});
it.each(["queued", "sending", "rejected", "unknown", "held"] as const)(
  "blocks %s events before a test clock can advance",
  (state) => {
    expect(guard.assertDemoBillingReady).toBeTypeOf("function");
    const input = ready();
    input.local.groups[0].deliveryQuantities[state] = "1";
    expect(() => guard.assertDemoBillingReady(input)).toThrow(/drain/i);
  },
);
it.each(["match", "incomplete", "reserved", "correction", "history"])(
  "blocks incomplete %s evidence",
  (kind) => {
    expect(guard.assertDemoBillingReady).toBeTypeOf("function");
    const input = ready();
    if (kind === "match") input.comparison.status = "mismatch";
    if (kind === "incomplete") input.local.complete = false;
    if (kind === "reserved") input.reservedQuantity = "1";
    if (kind === "correction")
      input.corrections.records = [
        { key: "c", sequence: 1, state: "provider_accepted" },
      ];
    if (kind === "history") input.corrections.isDone = false;
    expect(() => guard.assertDemoBillingReady(input)).toThrow();
  },
);
it("requires effective local units to have provider acceptance even if a partial aggregate currently matches", () => {
  expect(guard.assertDemoBillingReady).toBeTypeOf("function");
  const input = ready();
  input.local.groups[0].providerAcceptedScaledQuantity = "0";
  expect(() => guard.assertDemoBillingReady(input)).toThrow();
});
