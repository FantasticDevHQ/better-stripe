// NEW declared TEST intent built BEFORE SUT calls; never actual wire/provider proof.
import { expandedRawRetentionInput, own } from "./raw-retention-fixture.mjs";
export { own };
export const clone = structuredClone;
export function scenario({
  perLevel = 1,
  shared = false,
  strings = false,
} = {}) {
  const p = expandedRawRetentionInput(),
    sub = p.subscription,
    item = sub.items.data[0],
    coupons = new Map();
  for (const [level, key] of [
    ["subscription", "discounts"],
    ["item", "discounts"],
  ]) {
    const source = level === "subscription" ? sub : item,
      template = clone(source[key][0]);
    source[key] = Array.from({ length: perLevel }, (_, index) => {
      const d = clone(template),
        id = shared ? "shared-offer" : `${level}-offer-${index}`;
      d.id = `di_${level}_${index}`;
      const c = clone(template.source.coupon);
      c.id = id;
      c.times_redeemed = 7;
      c.metadata = { declared: "SYNTHETIC_314", keep: "coupon" };
      coupons.set(id, c);
      d.source.coupon = strings ? id : clone(c);
      return d;
    });
  }
  return {
    expected: clone(p.expected),
    subscription: sub,
    targetPrice: p.targetPrice,
    billingCustomer: p.billingCustomer,
    coupons,
  };
}
export function wire(body, metadata = { status: 200 }, descriptor = {}) {
  const reply = clone(body);
  Object.defineProperty(reply, "lastResponse", {
    value: metadata,
    enumerable: false,
    ...descriptor,
  });
  return reply;
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
export const tick = async () => {
  for (let i = 0; i < 1000; i++) await Promise.resolve();
};
export function fakeOwner(s, { invalid = false } = {}) {
  const initial = (s.expected.periodStart + 1) * 1000,
    basis = Object.freeze({
      startWallMs: initial,
      startNs: 1000000000n,
      workEndWallMs: initial + 5000,
      workEndNs: 6000000000n,
      endWallMs: initial + 8000,
      endNs: 9000000000n,
    });
  let wallMs = initial,
    ns = basis.startNs,
    retired = false,
    samples = 0;
  const events = [];
  return {
    basis,
    events,
    sample() {
      samples++;
      events.push(["sample", wallMs, String(ns), retired]);
      return { wallMs: invalid ? NaN : wallMs, ns, retired };
    },
    retire() {
      retired = true;
      events.push(["retire"]);
    },
    expire() {
      wallMs = basis.workEndWallMs;
      ns = basis.workEndNs;
    },
    regress() {
      wallMs = initial - 1;
      ns = basis.startNs - 1n;
    },
    get samples() {
      return samples;
    },
    get retired() {
      return retired;
    },
  };
}
export function fakeTransport(s, owner) {
  const calls = [],
    pending = new Map();
  let holdAt = null,
    override = null,
    rejectAt = null;
  const transport = {
    rawRequest(method, path, body, options) {
      const number = calls.length + 1;
      calls.push({ method, path, body, options: clone(options) });
      owner.events.push(["GET", number]);
      const url = new URL(path, "https://synthetic.invalid");
      let value;
      if (url.pathname === `/v1/subscriptions/${s.expected.subscriptionId}`)
        value = s.subscription;
      else if (url.pathname === `/v1/prices/${s.expected.targetPriceId}`)
        value = s.targetPrice;
      else if (url.pathname === `/v1/customers/${s.billingCustomer.id}`)
        value = s.billingCustomer;
      else if (url.pathname.startsWith("/v1/coupons/"))
        value = s.coupons.get(
          decodeURIComponent(url.pathname.slice("/v1/coupons/".length)),
        );
      else throw Error("SYNTHETIC_UNLISTED_READ");
      if (rejectAt === number)
        return Promise.reject(Error("SYNTHETIC_PRIVATE_REJECT_DO_NOT_EXPOSE"));
      const reply = override?.(number, value) ?? wire(value);
      if (holdAt === number) {
        const d = deferred();
        pending.set(number, { ...d, reply });
        return d.promise;
      }
      return Promise.resolve(reply);
    },
  };
  return {
    transport,
    calls,
    pending,
    hold(number) {
      holdAt = number;
    },
    override(fn) {
      override = fn;
    },
    reject(number) {
      rejectAt = number;
    },
    release(number, value) {
      const d = pending.get(number);
      if (!d) throw Error("SYNTHETIC_MISSING_HELD_GET");
      owner.events.push(["fulfilled", number]);
      d.resolve(value ?? d.reply);
    },
  };
}
