import type { EventRecord } from "./ownData.js";
import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
const { fixture, copy } = await import("./test-fixtures/fixture.mjs");
const { createAttachEventCompiler, createConfigureEventCompiler } =
  await import("./test-fixtures/compilerIndex.mjs");
const reverse = <T extends object>(a: T) =>
  new Proxy(a, { ownKeys: (t) => Reflect.ownKeys(t).reverse() });
const delivery = () => {
  const records: EventRecord[] = [];
  return {
    records,
    options: {
      timeoutMs: 5000,
      send: async (r: EventRecord, ack: (value: unknown) => void) => {
        records.push(r);
        ack({ sequence: r.sequence, binding: r.binding });
      },
    },
  };
};
test("array reflection order cannot change recorded request phase index values", async () => {
  const f = await fixture(),
    d = delivery(),
    c = createConfigureEventCompiler(f.sourceConfigure, d.options),
    request = copy(f.configure);
  request.payload.phases = reverse(request.payload.phases);
  await c.dispatch({ event: "dispatch", stage: "configure", request });
  assert.deepEqual(
    (d.records[0].data as { request: unknown }).request,
    f.configure,
  );
});
test("source array reflection order preserves canonical indexed raw preparation", async () => {
  const f = await fixture(),
    d = delivery(),
    source = copy(f.sourceAttach);
  const coupon = source.preparation.subscription.discounts[0].source.coupon;
  coupon.applies_to.products = reverse(coupon.applies_to.products);
  const c = createAttachEventCompiler(source, d.options);
  await c.dispatch({ event: "dispatch", stage: "attach", request: f.request });
  assert.deepEqual(
    (d.records[0].data as { request: unknown }).request,
    f.request,
  );
});
