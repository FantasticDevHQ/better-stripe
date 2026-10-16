import { expect, it } from "vitest";
import { payoutOutcomeBatches } from "./payoutOutcomeBatches.js";
it("bounds transaction work while retaining every outcome in order", () => {
  const rows = Array.from({ length: 103 }, (_, id) => ({
    id,
    allocationCount: id % 2 ? 600 : 100,
  }));
  const batches = payoutOutcomeBatches(rows);
  expect(batches.flat()).toEqual(rows);
  expect(batches.length).toBeGreaterThan(5);
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(25);
    expect(
      batch.reduce((n, row) => n + row.allocationCount, 0),
    ).toBeLessThanOrEqual(1000);
  }
});
it("retains a large individual outcome instead of imposing a new lifetime or claim cutoff", () => {
  const rows = [
    { id: 0, allocationCount: 2 },
    { id: 1, allocationCount: 2000 },
    { id: 2, allocationCount: 1 },
  ];
  expect(payoutOutcomeBatches(rows)).toEqual(rows.map((row) => [row]));
});
it("also bounds batches when many outcomes have no source movement", () => {
  const rows = Array.from({ length: 101 }, (_, id) => ({
    id,
    allocationCount: 0,
  }));
  expect(payoutOutcomeBatches(rows).map((b) => b.length)).toEqual([
    25, 25, 25, 25, 1,
  ]);
});
it("rejects invalid allocation work counts before reconciliation", () => {
  for (const allocationCount of [-1, 0.5, NaN, Infinity])
    expect(() => payoutOutcomeBatches([{ allocationCount }])).toThrow(
      "allocation count",
    );
});
