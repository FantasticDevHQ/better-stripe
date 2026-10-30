import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.doUnmock("./sourceOperations.js");
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("Source invocation acquisition must preserve its actual same-pair GET catch", async () => {
  vi.resetModules();
  const { ownedReadFailureFixture } =
    await import("../test-fixtures/ownedOperations.js");
  const h = await ownedReadFailureFixture();
  const { bindRawAcquisitionFromSource } =
    await import("../acquisition/ownedAcquisition.js");
  h.OWNER.check();
  expect(h.pair.capability.assertVirginAcquisition()).toBe(true);
  const reader = bindRawAcquisitionFromSource(
    h.OWNER,
    h.pair.transport.readTransport,
  );
  const result = await reader.acquire(h.prepared.expected);
  h.OWNER.check();
  expect(result.ok).toBe(false);
  expect(h.http.calls).toEqual([
    { url: h.http.expectedURL, method: "GET", redirect: "error" },
  ]);
  expect(h.pair.transport.postDisposition()).toBe("NOT_STARTED");
  // Intended new-binding RED: existing reader ran its real body and actual stock GET,
  // but its isolated delegate bypassed this pair's real catch capability.
  const record = h.pair.capability.consumeReadCatch();
  expect(record !== null).toBe(true);
  expect(record).toMatchObject({ phase: "read", ordinal: 1 });
  expect(h.pair.capability.consumeReadCatch()).toBe(null);
});

it("fixed actor transport associations require operation, readPlan, delegate and whole C2 before HTTP", async () => {
  const { scenario } = await import("../test-fixtures/attachScenario.js"),
    h = await scenario("G01-scalar");
  try {
    const {
      createInitialOwnedTransportWithAttemptCapability,
      createRecoveryOwnedTransportWithAttemptCapability,
      createOwnedTransportWithAttemptCapability,
    } = await import("./fixedTransport.js");
    const a = createInitialOwnedTransportWithAttemptCapability(),
      b = createRecoveryOwnedTransportWithAttemptCapability(),
      generic = createOwnedTransportWithAttemptCapability(),
      f = h.binding;
    assert.equal(
      a.capability.assertSourceOperationBinding(
        f.opB,
        f.request,
        f.plan,
        f.delegate,
      ),
      false,
    );
    assert.equal(
      b.capability.assertSourceOperationBinding(
        f.opA,
        f.request,
        f.plan,
        f.delegate,
      ),
      false,
    );
    assert.equal(
      a.capability.assertSourceOperationBinding(
        f.opA,
        f.request,
        [...f.plan],
        f.delegate,
      ),
      false,
    );
    assert.equal(
      a.capability.assertSourceOperationBinding(f.opA, f.request, f.plan, {}),
      false,
    );
    assert.equal(
      a.capability.assertSourceOperationBinding(
        f.opA,
        { ...f.request, firstDispatchedAt: f.request.firstDispatchedAt + 1 },
        f.plan,
        f.delegate,
      ),
      false,
    );
    assert.equal(
      generic.capability.assertSourceOperationBinding(
        f.opA,
        f.request,
        f.plan,
        f.delegate,
      ),
      false,
    );
    assert.equal(
      a.capability.assertSourceOperationBinding(
        f.opA,
        f.request,
        f.plan,
        f.delegate,
      ),
      true,
    );
    assert.equal(h.effectCounts().GET, 0);
    assert.equal(h.effectCounts().POST, 0);
  } finally {
    await h.cleanup();
  }
});
