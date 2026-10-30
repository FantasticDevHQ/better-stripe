// Controlled native Fetch Response metadata only: no fetch/network call or provider proof.
import { test } from "vitest";
import assert from "node:assert/strict";
import { createTestOnlyRawAcquisition } from "./test-fixtures/sourcePort.mjs";
import {
  scenario,
  wire,
  fakeOwner,
  fakeTransport,
} from "./test-fixtures/scenario.mjs";
function setup(metadata) {
  const s = scenario(),
    owner = fakeOwner(s),
    http = fakeTransport(s, owner);
  http.override((n, v) => wire(v, metadata()));
  return {
    owner,
    http,
    reader: createTestOnlyRawAcquisition({ owner, transport: http.transport }),
    expected: s.expected,
  };
}
test("maintained native Fetch Response status works without arbitrary metadata getters or shadow contradictions", async () => {
  const good = setup(() => new Response(null, { status: 200 })),
    result = await good.reader.acquire(good.expected);
  assert.equal(result.ok, true);
  assert.equal(good.http.calls.length, 5);
  assert.equal(result.sourceFulfillmentEstablished, false);
  let getterCalls = 0;
  for (const make of [
    () =>
      Object.defineProperty({}, "status", {
        get() {
          getterCalls++;
          throw Error("UNSAFE_STATUS_GETTER");
        },
      }),
    () => Object.create(Response.prototype),
    () => {
      const r = new Response(null, { status: 500 });
      Object.defineProperty(r, "status", { value: 200 });
      return r;
    },
    () => {
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, "statusCode", { value: 500 });
      return r;
    },
    () => {
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, "status", {
        get() {
          getterCalls++;
          return 200;
        },
      });
      return r;
    },
    () =>
      new Proxy(new Response(null, { status: 200 }), {
        get(t, k, r) {
          getterCalls++;
          return Reflect.get(t, k, r);
        },
      }),
  ]) {
    const h = setup(make),
      r = await h.reader.acquire(h.expected);
    assert.deepEqual(r, {
      ok: false,
      complete: false,
      code: "RAW_ACQUISITION_STOP",
    });
    assert.equal(h.http.calls.length, 1);
  }
  assert.equal(getterCalls, 0);
});
