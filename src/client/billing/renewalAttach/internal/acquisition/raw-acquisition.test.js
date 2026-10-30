// TEST SOURCE FIRST. Future test-only binding/production modules DO NOT exist/adopt yet.
import { test } from "vitest";
import assert from "node:assert/strict";
import { createTestOnlyRawAcquisition } from "./test-fixtures/sourcePort.mjs";
import {
  scenario,
  clone,
  own,
  wire,
  tick,
  fakeOwner,
  fakeTransport,
} from "./test-fixtures/scenario.mjs";
import { parsedPaths, at } from "./test-fixtures/raw-retention-fixture.mjs";
function setup(s = scenario(), ownerOptions = {}) {
  const owner = fakeOwner(s, ownerOptions),
    http = fakeTransport(s, owner),
    reader = createTestOnlyRawAcquisition({ owner, transport: http.transport });
  return { s, owner, http, reader };
}
async function stop(p) {
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.complete, false);
  assert.equal(r.code, "RAW_ACQUISITION_STOP");
  return r;
}
function good(r) {
  assert.equal(r.ok, true);
  assert.equal(r.dataOnly, true);
  assert.equal(r.sourceFulfillmentEstablished, false);
  assert.equal(r.clockProvenanceEstablished, false);
  assert.equal(r.operatorReady, false);
  return r.bundle;
}
const COUPON_PATH = "/v1/coupons/";
test("three complete raw bodies remain detached and immutable, derived joins distinct", async () => {
  const h = setup(),
    r = await h.reader.acquire(h.s.expected),
    b = good(r);
  assert.deepEqual(b.wireSubscription, h.s.subscription);
  assert.deepEqual(b.wireTargetPrice, h.s.targetPrice);
  assert.deepEqual(b.wireBillingCustomer, h.s.billingCustomer);
  assert.deepEqual(
    Object.keys(b).sort(),
    [
      "wireSubscription",
      "wireTargetPrice",
      "wireBillingCustomer",
      "couponReads",
      "derivedCouponJoins",
    ].sort(),
  );
  assert(
    Object.isFrozen(r) &&
      Object.isFrozen(b) &&
      Object.isFrozen(b.wireSubscription),
  );
  h.s.subscription.metadata.after = "MUTATED_SOURCE";
  assert(!Object.hasOwn(b.wireSubscription.metadata, "after"));
  assert.notEqual(
    b.derivedCouponJoins.subscription[0].joinedDiscount,
    b.wireSubscription.discounts[0],
  );
  assert.deepEqual(
    b.wireSubscription.discounts[0].source.coupon,
    h.s.coupons.get("subscription-offer-0"),
  );
});
test("eleven own special-key paths retain full raw values, constructor/prototype safe", async () => {
  for (const path of parsedPaths) {
    const s = scenario(),
      input = {
        subscription: s.subscription,
        targetPrice: s.targetPrice,
        billingCustomer: s.billingCustomer,
      };
    own(at(input, path), "__proto__", { declared: "same-raw" });
    own(at(input, path), "constructor", { keep: true });
    own(at(input, path), "prototype", "raw");
    const h = setup(s),
      b = good(await h.reader.acquire(s.expected)),
      out = {
        subscription: b.wireSubscription,
        targetPrice: b.wireTargetPrice,
        billingCustomer: b.wireBillingCustomer,
      };
    assert.deepEqual(at(out, path), at(input, path));
    assert(Object.hasOwn(at(out, path), "__proto__"));
    assert.equal({}.declared, undefined);
  }
});
test("full Coupon counters and expanded equality include unknown own keys", async () => {
  const s = scenario();
  for (const c of s.coupons.values())
    own(c, "__proto__", { counterpart: "keep" });
  s.subscription.discounts[0].source.coupon = clone(
    s.coupons.get("subscription-offer-0"),
  );
  s.subscription.items.data[0].discounts[0].source.coupon = clone(
    s.coupons.get("item-offer-0"),
  );
  const h = setup(s),
    b = good(await h.reader.acquire(s.expected));
  assert.equal(b.couponReads[0].wireCoupon.times_redeemed, 7);
  assert(Object.hasOwn(b.couponReads[0].wireCoupon, "__proto__"));
  const drift = scenario();
  drift.coupons.get("subscription-offer-0").times_redeemed = 8;
  await stop(setup(drift).reader.acquire(drift.expected));
  const unknown = scenario();
  own(unknown.coupons.get("subscription-offer-0"), "__proto__", {
    drift: true,
  });
  await stop(setup(unknown).reader.acquire(unknown.expected));
});
test("string references join only derived arrays with source indices and retain raw originals", async () => {
  const h = setup(scenario({ strings: true })),
    b = good(await h.reader.acquire(h.s.expected));
  assert.equal(typeof b.wireSubscription.discounts[0].source.coupon, "string");
  for (const [level, raw] of [
    ["subscription", b.wireSubscription.discounts],
    ["item", b.wireSubscription.items.data[0].discounts],
  ])
    for (const [index, j] of b.derivedCouponJoins[level].entries()) {
      assert.equal(j.index, index);
      assert.equal(j.discountId, raw[index].id);
      assert.equal(j.originalCouponReference, raw[index].source.coupon);
      assert.deepEqual(
        j.joinedDiscount.source.coupon,
        b.couponReads[j.couponReadIndex].wireCoupon,
      );
    }
});
test("dedup first appearance order and maximum43 direct GETs with exact selectors", async () => {
  const h = setup(scenario({ perLevel: 20, strings: true })),
    b = good(await h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, 43);
  assert.equal(b.couponReads.length, 40);
  const calls = h.http.calls;
  assert.equal(
    calls[0].path,
    `/v1/subscriptions/${h.s.expected.subscriptionId}?expand%5B0%5D=discounts&expand%5B1%5D=items.data.discounts&expand%5B2%5D=items.data.price`,
  );
  assert.equal(calls[1].path, `/v1/prices/${h.s.expected.targetPriceId}`);
  assert.equal(calls[2].path, `/v1/customers/${h.s.billingCustomer.id}`);
  assert.deepEqual(
    calls
      .slice(3)
      .map((x) => decodeURIComponent(x.path.slice(COUPON_PATH.length))),
    [...h.s.coupons.keys()],
  );
  for (const c of calls) {
    assert.equal(c.method, "GET");
    assert.equal(c.body, undefined);
    assert.deepEqual(c.options, {
      apiVersion: "2026-09-30.endive",
      maxNetworkRetries: 0,
    });
  }
  const shared = setup(scenario({ perLevel: 20, shared: true, strings: true }));
  const sb = good(await shared.reader.acquire(shared.s.expected));
  assert.equal(shared.http.calls.length, 4);
  assert.equal(sb.couponReads.length, 1);
});
test("empty arrays return3reads;21redemptions or dot segments never extra reads", async () => {
  const h = setup(scenario({ perLevel: 0 }));
  good(await h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, 3);
  const too = setup(scenario({ perLevel: 21 }));
  await stop(too.reader.acquire(too.s.expected));
  assert(too.http.calls.length <= 3);
  for (const id of [".", ".."]) {
    const s = scenario({ strings: true });
    s.subscription.discounts[0].source.coupon = id;
    const q = setup(s);
    await stop(q.reader.acquire(s.expected));
    assert(!q.http.calls.some((c) => c.path === COUPON_PATH + id));
  }
});
test("all raw identity/account/mode/deleted/coupon contradictions stop without normalization", async () => {
  for (const change of [
    (s) => (s.subscription.id = "sub_foreign"),
    (s) => (s.targetPrice.id = "price_foreign"),
    (s) => (s.billingCustomer.customer_account = "acct_foreign"),
    (s) => (s.subscription.items.data[0].price.livemode = true),
    (s) => (s.billingCustomer.deleted = true),
    (s) => (s.coupons.get("subscription-offer-0").deleted = true),
    (s) => (s.coupons.get("subscription-offer-0").livemode = true),
  ]) {
    const s = scenario();
    change(s);
    const h = setup(s);
    await stop(h.reader.acquire(s.expected));
    assert(h.http.calls.length <= 5);
  }
});
test("own schedule reference remains observation, never invented null or attach receipt", async () => {
  const s = scenario();
  s.subscription.schedule = "sub_sched_observed";
  const h = setup(s),
    b = good(await h.reader.acquire(s.expected));
  assert.equal(b.wireSubscription.schedule, "sub_sched_observed");
  assert(!Object.hasOwn(b, "attachReceipt"));
  assert(!h.http.calls.some((x) => x.path.includes("subscription_schedules")));
});
test("whole duplicate-inclusive bundle budgets rather than each small body alone", async () => {
  const s = scenario();
  for (const c of s.coupons.values()) c.metadata.opaque = "x".repeat(90000);
  for (const [list, key] of [
    [s.subscription.discounts, "subscription-offer-0"],
    [s.subscription.items.data[0].discounts, "item-offer-0"],
  ])
    list[0].source.coupon = clone(s.coupons.get(key));
  const h = setup(s);
  await stop(h.reader.acquire(s.expected));
  assert(h.http.calls.length <= 5);
  const utf = scenario();
  for (const c of utf.coupons.values()) c.metadata.opaque = "😀".repeat(30000);
  utf.subscription.discounts[0].source.coupon = clone(
    utf.coupons.get("subscription-offer-0"),
  );
  utf.subscription.items.data[0].discounts[0].source.coupon = clone(
    utf.coupons.get("item-offer-0"),
  );
  await stop(setup(utf).reader.acquire(utf.expected));
});
test("node/depth and unsafe raw metadata fail before successful bundle release", async () => {
  for (const make of [
    () => Array.from({ length: 10001 }, () => 0),
    () => {
      let x = {};
      for (let n = 0; n < 41; n++) x = { x };
      return x;
    },
    () => ({ client_secret: {} }),
  ]) {
    const s = scenario();
    s.subscription.extra = make();
    const h = setup(s);
    await stop(h.reader.acquire(s.expected));
    assert(h.http.calls.length <= 1);
  }
});
test("2xx own nonenumerable metadata required, ambiguities never become body facts", async () => {
  for (const make of [
    (v) => clone(v),
    (v) => wire(v, { status: 200, statusCode: 201 }),
    (v) => wire(v, { status: 500 }),
    (v) => wire(v, { status: 200 }, { enumerable: true }),
    (v) => {
      const r = clone(v);
      Object.defineProperty(r, "lastResponse", {
        get() {
          throw Error("UNSAFE_META_GETTER");
        },
      });
      return r;
    },
  ]) {
    const h = setup();
    h.http.override((n, v) => (n === 1 ? make(v) : null));
    await stop(h.reader.acquire(h.s.expected));
    assert.equal(h.http.calls.length, 1);
  }
  const h = setup();
  h.http.override((n, v) =>
    n === 1 ? wire(v, { status: 200, statusCode: 200 }) : null,
  );
  const b = good(await h.reader.acquire(h.s.expected));
  assert(!Object.hasOwn(b.wireSubscription, "lastResponse"));
});
test("raw getters symbols nonJSON and rejected partials give content-free failure", async () => {
  for (const make of [
    (v) => {
      const r = wire(v);
      Object.defineProperty(r, "unknown", {
        get() {
          throw Error("BODY_GETTER");
        },
        enumerable: true,
      });
      return r;
    },
    (v) => {
      const r = wire(v);
      r[Symbol("unknown")] = 1;
      return r;
    },
    (v) => {
      const r = wire(v);
      r.bad = NaN;
      return r;
    },
  ]) {
    const h = setup();
    h.http.override((n, v) => (n === 1 ? make(v) : null));
    await stop(h.reader.acquire(h.s.expected));
  }
  const h = setup();
  h.http.reject(2);
  const r = await stop(h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, 2);
  assert(!JSON.stringify(r).includes("SYNTHETIC_PRIVATE_REJECT"));
});
test("reservation is synchronous: overlapping and second invocation never repeat reads", async () => {
  const h = setup();
  h.http.hold(1);
  const first = h.reader.acquire(h.s.expected);
  await tick();
  assert.equal(h.http.calls.length, 1);
  await stop(h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, 1);
  h.http.release(1);
  good(await first);
  const reads = h.http.calls.length;
  await stop(h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, reads);
});
test("invalid or regressed original basis refuses before first GET, no reset", async () => {
  const h = setup(scenario(), { invalid: true });
  await stop(h.reader.acquire(h.s.expected));
  assert.equal(h.http.calls.length, 0);
  const q = setup();
  q.owner.regress();
  await stop(q.reader.acquire(q.s.expected));
  assert.equal(q.http.calls.length, 0);
});
test("late retired fulfillment at EACH of43GET awaits cannot start nextIO or release", async () => {
  for (let at = 1; at <= 43; at++) {
    const h = setup(scenario({ perLevel: 20, strings: true }));
    h.http.hold(at);
    const p = h.reader.acquire(h.s.expected);
    await tick();
    assert.equal(h.http.calls.length, at);
    h.owner.retire();
    h.http.release(at);
    await stop(p);
    assert.equal(h.http.calls.length, at);
    await stop(h.reader.acquire(h.s.expected));
    assert.equal(h.http.calls.length, at);
  }
});
test("late work expiry at each base/Coupon await cannot acquire new basis", async () => {
  for (let at = 1; at <= 5; at++) {
    const h = setup();
    h.http.hold(at);
    const p = h.reader.acquire(h.s.expected);
    await tick();
    assert.equal(h.http.calls.length, at);
    h.owner.expire();
    h.http.release(at);
    await stop(p);
    assert.equal(h.http.calls.length, at);
  }
});
test("retired late rawbody never reflected, parsed, cloned, classified or returned", async () => {
  const h = setup();
  h.http.hold(1);
  const p = h.reader.acquire(h.s.expected);
  await tick();
  let reflections = 0,
    armed = false,
    assimilationReads = 0;
  const raw = new Proxy(wire(h.s.subscription), {
    ownKeys(t) {
      reflections++;
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      reflections++;
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    getPrototypeOf(t) {
      reflections++;
      return Reflect.getPrototypeOf(t);
    },
    get(t, k, r) {
      if (armed) reflections++;
      else {
        assert.equal(k, "then");
        assimilationReads++;
      }
      return Reflect.get(t, k, r);
    },
    has(t, k) {
      reflections++;
      return Reflect.has(t, k);
    },
  });
  h.owner.retire();
  // Promise resolution synchronously reads missing `then` inside release().
  // Arm before any queued SUT continuation: no after-await body access exempted.
  h.http.release(1, raw);
  armed = true;
  assert.equal(assimilationReads, 1);
  await stop(p);
  assert.equal(reflections, 0);
  assert.equal(h.http.calls.length, 1);
});
test("clock check remains between every completed GET and successor GET; complete reader not actor authority", async () => {
  const h = setup();
  const r = await h.reader.acquire(h.s.expected);
  good(r);
  const events = h.owner.events;
  for (let i = 1; i < events.length; i++)
    if (events[i][0] === "GET") {
      assert(events.slice(0, i).some((x) => x[0] === "sample"));
      const prev = events
        .slice(0, i)
        .map((x) => x[0])
        .lastIndexOf("GET");
      if (prev >= 0)
        assert(events.slice(prev + 1, i).some((x) => x[0] === "sample"));
    }
  assert.equal(r.clockProvenanceEstablished, false);
  assert.equal(h.owner.retired, false);
  assert.equal(r.observedAt, Math.floor(h.s.expected.periodStart + 1));
});
