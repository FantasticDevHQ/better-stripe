import assert from "node:assert/strict";
import type { PreflightFixture } from "./configurePreflightOperation.js";
import { data } from "./configurePreflightControls.js";
import { configureReadMetrics as metrics } from "./configureReadOperation.js";

export { metrics };

export function assertFit(value: unknown) {
  const result = metrics(value);
  assert(result.chars <= 500000 && result.bytes <= 500000);
  assert(result.nodes <= 10000 && result.depth <= 40);
  return result;
}

export function assertNoPreflightWrites(
  h: PreflightFixture,
  expectedOwner: "live" | "retired" = "live",
) {
  assert.equal(h.deltas().POST, 0);
  assert.equal(h.deltas().records, 0);
  if (expectedOwner === "retired")
    assert.throws(() => h.OWNER.basis, {
      name: "Error",
      message: "ORIGINAL_OWNER_STOP",
    });
  else assert.equal(h.OWNER.basis, h.basis);
}

export function expectedPreflightOutput(h: PreflightFixture) {
  return {
    status: "configure_preflight_consistent",
    originalRecord: h.expectedRecord,
    currentEvidence: h.expectedEvidence,
    request: h.projected,
    operationalAuthority: false,
  };
}

export function assertPreflightPositive(h: PreflightFixture, value: unknown) {
  const out = data(value);
  assert.deepEqual(out, expectedPreflightOutput(h));
  assert.deepEqual(Object.keys(out).sort(), [
    "currentEvidence",
    "operationalAuthority",
    "originalRecord",
    "request",
    "status",
  ]);
  assert.equal(Object.keys(data(out.originalRecord)).length, 4);
  assert.equal(Object.keys(data(out.currentEvidence)).length, 3);
  assert.equal(Object.keys(data(out.request)).length, 18);
  const receipt = data(h.acknowledgement),
    attach = data(receipt.request);
  const recordSlots: [string[], unknown][] = [
    [["request", "logicalBinding"], h.projected.logicalBinding],
    [["request", "attachReceiptBinding"], h.projected.attachReceiptBinding],
    [["request", "baselineBinding"], h.projected.baselineBinding],
    [["request", "defaultSettingsBinding"], h.projected.defaultSettingsBinding],
    [
      ["request", "requestIdentity", "binding"],
      h.projected.requestIdentity.binding,
    ],
    [["attachReceipt", "logicalBinding"], receipt.logicalBinding],
    [["attachReceipt", "request", "logicalBinding"], attach.logicalBinding],
    [
      ["attachReceipt", "request", "requestIdentity", "binding"],
      data(attach.requestIdentity).binding,
    ],
    [["attachReceipt", "binding"], receipt.binding],
  ];
  const allSlots: [string[], unknown][] = [
    ...recordSlots.map(([path, expected]): [string[], unknown] => [
      ["originalRecord", ...path],
      expected,
    ]),
    ...recordSlots.slice(0, 5),
  ];
  assert.equal(allSlots.length, 14);
  for (const [path, expected] of allSlots) {
    let found: unknown = out;
    for (const key of path) found = data(found)[key];
    assert.equal(found, expected);
  }
  assert(Object.isFrozen(out));
  for (const key of ["originalRecord", "currentEvidence", "request"] as const)
    assert(Object.isFrozen(out[key]));
  assert(Object.isFrozen(data(out.currentEvidence).schedule));
  assert.notEqual(data(out.originalRecord).attachReceipt, h.acknowledgement);
  assert.equal(
    data(out.currentEvidence).observedAt,
    Math.floor(h.declared.scheduleAt / 1000),
  );
  assert.equal(h.state.c6, 2);
  assert.equal(h.state.c3, 1); // Explicit actor reconstruction; not nested constructor internals.
  assert.equal(h.state.releaseEntries, 1);
  assert.equal(h.state.coverage, 1);
  assert.equal(h.state.pairLoads, 1);
  assert.equal(h.state.pairCreations, 1);
  assert.equal(h.state.readerBindings, 1);
  assert.equal(h.state.children, 1);
  assert.equal(h.state.finishes, 1);
  assert.equal(h.state.finishAt, h.declared.scheduleAt);
  assert.equal(
    h.deltas().GET,
    4 + h.declared.original.originalBundle.couponReads.length,
  );
  assert(h.deltas().GET <= 44);
  assertNoPreflightWrites(h);
  assert.equal(h.OWNER.check().retired, false);
  for (const [part, item] of [
    ["record", h.expectedRecord],
    ["currentEvidence", out.currentEvidence],
    ["output", out],
  ] as const)
    console.log(
      JSON.stringify({
        kind: "OWNED_PREFLIGHT_ACTUAL_METRICS",
        part,
        ...assertFit(item),
      }),
    );
}
