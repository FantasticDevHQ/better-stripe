// Independent one-run Source/data probe. No real provider/native/owner operation.
import { test } from "vitest";
import assert from "node:assert/strict";
import { createTestOnlyRawAcquisition } from "./test-fixtures/sourcePort.mjs";
import {
  scenario,
  wire,
  fakeOwner,
  fakeTransport,
} from "./test-fixtures/scenario.mjs";
async function run(permuted) {
  const s = scenario();
  s.subscription.fullRawArray = [{ sourceIndex: 0 }, { sourceIndex: 1 }];
  const owner = fakeOwner(s),
    http = fakeTransport(s, owner);
  let target;
  if (permuted)
    http.override((n, v) => {
      if (n !== 1) return null;
      const reply = wire(v);
      target = reply.fullRawArray;
      reply.fullRawArray = new Proxy(target, {
        ownKeys() {
          return ["1", "0", "length"];
        },
      });
      return reply;
    });
  const reader = createTestOnlyRawAcquisition({
    owner,
    transport: http.transport,
  });
  return { result: await reader.acquire(s.expected), http, target };
}
test("complete raw numeric array order is retained or STOP, never silently permuted", async () => {
  const baseline = await run(false);
  assert.equal(baseline.result.ok, true);
  assert.deepEqual(baseline.result.bundle.wireSubscription.fullRawArray, [
    { sourceIndex: 0 },
    { sourceIndex: 1 },
  ]);
  assert.equal(baseline.http.calls.length, 5);
  const permuted = await run(true);
  console.log(
    "SYNTHETIC_ARRAY_ORDER",
    JSON.stringify({
      baselineOK: baseline.result.ok,
      permutedOK: permuted.result.ok,
      sourceIndices: permuted.target.map((x) => x.sourceIndex),
      retainedIndices: permuted.result.ok
        ? permuted.result.bundle.wireSubscription.fullRawArray.map(
            (x) => x.sourceIndex,
          )
        : null,
      directGETs: permuted.http.calls.length,
      actualProviderCalls: 0,
    }),
  );
  if (permuted.result.ok)
    assert.deepEqual(permuted.result.bundle.wireSubscription.fullRawArray, [
      { sourceIndex: 0 },
      { sourceIndex: 1 },
    ]);
  else
    assert.deepEqual(permuted.result, {
      ok: false,
      complete: false,
      code: "RAW_ACQUISITION_STOP",
    });
});
