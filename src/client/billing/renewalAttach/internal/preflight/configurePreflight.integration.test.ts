import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { configurePreflightFixture } from "../test-fixtures/configurePreflightOperation.js";
import {
  assertPreflightPositive,
  assertNoPreflightWrites,
  assertFit,
  expectedPreflightOutput,
  metrics,
} from "../test-fixtures/configurePreflightAssertions.js";
import {
  data,
  type PreflightCase,
} from "../test-fixtures/configurePreflightControls.js";
import {
  cleanPreflightMocks,
  installEmptyPreflightSpies,
} from "../test-fixtures/configurePreflightBarriers.js";

it("owned configure preflight returns full evidence after actual initial ACK", async () => {
  const h = await configurePreflightFixture();
  try {
    const handle = h.capture();
    const out = await handle.invoke();
    assertPreflightPositive(h, out);
    await assert.rejects(handle.invoke());
    assertNoPreflightWrites(h);
  } finally {
    await h.cleanup();
  }
});

it("normal configure preflight registry refuses before Source or Owner effects", async () => {
  vi.resetModules();
  const counts = installEmptyPreflightSpies();
  try {
    const { captureOwnedConfigurePreflightV2 } =
      await import("./configurePreflight.js");
    assert.throws(() => captureOwnedConfigurePreflightV2(), {
      message: "CONFIGURE_PREFLIGHT_SOURCE_UNBOUND",
    });
    assert.deepEqual(counts, {
      Source: 0,
      Owner: 0,
      check: 0,
      sample: 0,
      client: 0,
      capture: 0,
      api: 0,
      read: 0,
    });
  } finally {
    cleanPreflightMocks();
  }
});

for (const name of [
  "foreign-owner",
  "foreign-origin",
  "foreign-entry",
  "foreign-preflight-entry",
  "foreign-delegate",
  "foreign-ack",
  "foreign-pair",
  "retired-capture",
] as const)
  it("owned configure preflight rejects " + name, async () => {
    const h = await configurePreflightFixture(name);
    try {
      await assert.rejects(async () => h.capture().invoke());
      assert.equal(h.deltas().GET, 0);
      assert.equal(h.state.operationLoads, name === "retired-capture" ? 0 : 1);
      assert.equal(h.state.readonlyCalls, 0);
      assert.equal(h.state.releaseEntries, 0);
      const pairFrontier =
        name === "foreign-pair" || name === "foreign-delegate";
      assert.equal(h.state.c6, pairFrontier ? 1 : 0);
      assert.equal(h.state.c3, pairFrontier ? 1 : 0);
      assert.equal(h.state.pairLoads, pairFrontier ? 1 : 0);
      assertNoPreflightWrites(
        h,
        name === "retired-capture" ? "retired" : "live",
      );
    } finally {
      await h.cleanup();
    }
  });

// The remaining four retained-receipt slots are immutable actual ACK custody inputs.
// Their direct release/capture value controls remain in the existing seven helper units.
for (let index = 0; index < 5; index++)
  it(
    "owned configure preflight rejects retained request token " + index,
    async () => {
      const h = await configurePreflightFixture("record-token", index);
      try {
        await assert.rejects(async () => h.capture().invoke());
        assert.equal(h.state.c6, 1);
        assert.equal(h.state.c3, 1);
        assert.equal(h.deltas().GET, 0);
        assert.equal(h.state.releaseEntries, 0);
        assertNoPreflightWrites(h);
      } finally {
        await h.cleanup();
      }
    },
  );

it("original public C6 Failure preserves its exact object before record proof or reads", async () => {
  const h = await configurePreflightFixture("original-failure");
  try {
    const oracle = await h.directOriginal();
    assert.notEqual(oracle.status, "projected_configure_request");
    const out = await h.capture().invoke();
    assert.deepEqual(out, oracle);
    assert.equal(out, h.state.c6Results[0]);
    assert.equal(h.state.c6, 1);
    assert.equal(h.state.c3, 0);
    assert.equal(h.state.pairLoads, 0);
    assert.equal(h.state.coverage, 0);
    assert.equal(h.state.releaseEntries, 0);
    assert.equal(h.deltas().GET, 0);
    assertNoPreflightWrites(h);
  } finally {
    await h.cleanup();
  }
});

it("owned configure preflight capture-once and exact arity reject before extra work", async () => {
  const h = await configurePreflightFixture();
  try {
    assert.throws(() => Reflect.apply(h.capture, undefined, [{}]));
    assert.equal(h.state.operationLoads, 0);
    const handle = h.capture();
    assert.equal(h.state.operationLoads, 1);
    assert.throws(() => h.capture());
    await assert.rejects(Reflect.apply(handle.invoke, handle, [{}]));
    assert.equal(h.state.operationLoads, 1);
    assert.equal(h.state.c6, 0);
    assert.equal(h.state.readonlyCalls, 0);
    assert.equal(h.deltas().GET, 0);
    assertNoPreflightWrites(h);
  } finally {
    await h.cleanup();
  }
});

it("retired original Owner rejects Source tuple Proxy before any trap or Source load", async () => {
  const h = await configurePreflightFixture("retired-proxy");
  try {
    assert.throws(() => h.capture());
    assert.equal(h.state.tupleTraps, 0);
    assert.equal(h.state.operationLoads, h.beforeCapture.operationLoads);
    assert.equal(h.state.samples, h.beforeCapture.samples);
    assert.equal(h.state.c6, 0);
    assert.equal(h.state.pairLoads, 0);
    assert.equal(h.state.readonlyCalls, 0);
    assert.equal(h.deltas().GET, 0);
    assertNoPreflightWrites(h, "retired");
  } finally {
    await h.cleanup();
  }
});

it("same readonly delegate retargeted during original C6 cannot replace its captured method", async () => {
  const h = await configurePreflightFixture("method-retarget");
  try {
    await assert.rejects(async () => h.capture().invoke());
    assert.equal(h.state.methodRetargets, 1);
    assert.equal(h.state.operationLoads, 1);
    assert.equal(h.state.c6, 1);
    assert.equal(h.state.c3, 1);
    assert.equal(h.state.pairLoads, 1);
    assert.equal(h.state.pairCreations, 1);
    assert.equal(h.state.readerBindings, 0);
    assert.equal(h.state.readonlyCalls, 0);
    assert.equal(h.deltas().GET, 0);
    assertNoPreflightWrites(h);
  } finally {
    await h.cleanup();
  }
});

for (const name of [
  "subscription-drift",
  "price-drift",
  "customer-drift",
  "coupon-drift",
  "reference-drift",
  "schedule-opaque",
  "schedule-default",
  "schedule-phase",
] as const)
  it("owned configure preflight refuses complete raw " + name, async () => {
    const h = await configurePreflightFixture(name);
    try {
      await assert.rejects(async () => h.capture().invoke());
      assert.equal(h.state.c6, 1);
      assert.equal(h.state.releaseEntries, 0);
      assertNoPreflightWrites(h);
    } finally {
      await h.cleanup();
    }
  });

for (const name of [
  "hold-schedule",
  "hold-original",
  "hold-fresh",
] satisfies PreflightCase[])
  it(
    "owned configure preflight stops retired outer continuation at " + name,
    async () => {
      const h = await configurePreflightFixture(name);
      const pending = h.capture().invoke();
      const observed = pending.then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error }),
      );
      try {
        await h.gates.enterOrSettled(pending);
        h.OWNER.retire();
        h.gates.release();
        assert.equal((await observed).ok, false);
        assert.equal(h.state.releaseEntries, 0);
        if (name === "hold-original") assert.equal(h.deltas().GET, 0);
        if (name === "hold-schedule") assert.equal(h.state.c6, 1);
        assertNoPreflightWrites(h, "retired");
      } finally {
        h.gates.release();
        await observed;
        await h.cleanup();
      }
    },
  );

it("later original Owner liveness sample does not replace Schedule observedAt", async () => {
  const h = await configurePreflightFixture("later-sample");
  try {
    const out = await h.capture().invoke();
    assertPreflightPositive(h, out);
    assert.equal(h.OWNER.check().wallMs, h.declared.laterAt);
    assert.notEqual(
      data(data(out).currentEvidence).observedAt,
      h.OWNER.check().nowSeconds,
    );
  } finally {
    await h.cleanup();
  }
});

it("whole duplicate-inclusive preflight output refuses after fitting earlier components", async () => {
  const h = await configurePreflightFixture("output-overflow");
  try {
    assertFit(h.expectedRecord);
    assertFit(h.expectedEvidence);
    const expected = expectedPreflightOutput(h),
      whole = metrics(expected);
    assert(
      whole.chars > 500000 || whole.bytes > 500000,
      "TEST_OUTPUT_ONLY_OVERFLOW_PREREQUISITE",
    );
    await assert.rejects(async () => h.capture().invoke());
    assert.equal(h.state.c6, 2);
    assert.equal(
      data(h.state.c6Results[1]).status,
      "projected_configure_request",
    );
    assert.equal(h.state.releaseEntries, 1);
    assert.equal(h.state.coverage, 1);
    assert.equal(
      h.deltas().GET,
      4 + h.declared.original.originalBundle.couponReads.length,
    );
    assertNoPreflightWrites(h);
    console.log(
      JSON.stringify({
        kind: "PREFLIGHT_OUTPUT_ONLY_OVERFLOW_FRONTIER",
        ...whole,
      }),
    );
  } finally {
    await h.cleanup();
  }
});
