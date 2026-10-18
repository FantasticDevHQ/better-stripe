import { expect, it } from "vitest";
import * as guard from "./cleanupGuard";
it("requires a paid native invoice and ready original cash evidence before cleanup", () => {
  expect(() =>
    guard.assertDemoCleanupReady({
      status: "paid",
      invoiceId: "in_original",
      revenue: [{ cash: { status: "ready" }, settlement: null }],
    }),
  ).not.toThrow();
  for (const state of ["unknown", "not_ready", "conflict", "rejected"]) {
    expect(() =>
      guard.assertDemoCleanupReady({
        status: "paid",
        invoiceId: "in_original",
        revenue: [{ cash: { status: state } }],
      }),
    ).toThrow(/cash/i);
    expect(() =>
      guard.assertDemoCleanupReady({
        status: "paid",
        invoiceId: "in_original",
        revenue: [{ cash: { status: "ready" }, settlement: { status: state } }],
      }),
    ).toThrow(/settlement/i);
  }
});
it.each([
  null,
  { status: "held" },
  { status: "paid", invoiceId: "in_original", revenue: [] },
])("preserves unresolved financial operations %j", (value) => {
  expect(() => guard.assertDemoCleanupReady(value)).toThrow();
});
