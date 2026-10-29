/** Internal owner mechanics; Source origin and production bindings remain unbound. */
import { types } from "node:util";
import { loadOwnedOriginalSource } from "./sourceBindings.js";

export interface OriginalBasis {
  readonly startWallMs: number;
  readonly startNs: bigint;
  readonly workEndWallMs: number;
  readonly workEndNs: bigint;
  readonly endWallMs: number;
  readonly endNs: bigint;
}
export interface OriginalSample {
  readonly wallMs: number;
  readonly ns: bigint;
  readonly nowSeconds: number;
  readonly retired: false;
}

function stop(): never {
  throw new Error("ORIGINAL_OWNER_STOP");
}
function need(value: unknown): asserts value {
  if (!value) stop();
}
const isProxy = types.isProxy;
const u64 = 18446744073709551615n;
const ms = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const ns = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n && value <= u64;
function own<K extends string>(
  value: unknown,
  names: readonly K[],
): Record<K, unknown> {
  need(!isProxy(value));
  need(value !== null && typeof value === "object" && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  need(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(value);
  need(
    keys.length === names.length &&
      keys.every((key) => typeof key === "string" && names.includes(key as K)),
  );
  const result = Object.create(null) as Record<K, unknown>;
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(
      descriptor &&
        descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, "value"),
    );
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
    });
  }
  return result;
}
interface Context {
  readonly basis: Readonly<OriginalBasis>;
  readonly policy: Readonly<{
    firstDispatchedAt: number;
    periodStart: number;
    periodEnd: number;
  }>;
  readonly sample: (...args: never[]) => unknown;
  readonly clock: object;
  readonly originAssociation: object;
}
let state: string = "unused";
let context: Context | null = null;
let checking = false;
let last: Readonly<OriginalSample> | null = null;
let detachClock: (() => void) | null = null;
let detached = false;
const waiters = new Set<{ fn: () => void; active: boolean }>();
// Source registration can synchronously reenter and close the latch.
const isClosed = () => state === "closed";
function detach() {
  if (!detached && detachClock) {
    detached = true;
    try {
      Reflect.apply(detachClock, undefined, []);
    } catch {
      /* Closing remains irreversible. */
    }
  }
}
function notify(fn: () => void) {
  try {
    Reflect.apply(fn, undefined, []);
  } catch {
    /* One waiter cannot prevent retirement. */
  }
}
function close() {
  if (state === "closed") return;
  state = "closed";
  detach();
  const active = [...waiters];
  waiters.clear();
  for (const record of active)
    if (record.active) {
      record.active = false;
      notify(record.fn);
    }
}
function initialize(): Context {
  if (state === "closed") stop();
  if (state === "loading") {
    close();
    stop();
  }
  if (state === "live") {
    need(context);
    return context;
  }
  state = "loading";
  try {
    const loaded = loadOwnedOriginalSource();
    need(state === "loading");
    const source = own(loaded, [
      "clock",
      "originalPolicy",
      "originAssociation",
    ]);
    const clock = own(source.clock, ["basis", "sample", "subscribeRetirement"]);
    const basis = own(clock.basis, [
      "startWallMs",
      "startNs",
      "workEndWallMs",
      "workEndNs",
      "endWallMs",
      "endNs",
    ]);
    need(
      ms(basis.startWallMs) &&
        ms(basis.workEndWallMs) &&
        ms(basis.endWallMs) &&
        ns(basis.startNs) &&
        ns(basis.workEndNs) &&
        ns(basis.endNs) &&
        basis.startWallMs < basis.workEndWallMs &&
        basis.workEndWallMs <= basis.endWallMs &&
        basis.startNs < basis.workEndNs &&
        basis.workEndNs <= basis.endNs,
    );
    const policy = own(source.originalPolicy, [
      "firstDispatchedAt",
      "periodStart",
      "periodEnd",
    ]);
    need(
      ms(policy.firstDispatchedAt) &&
        ms(policy.periodStart) &&
        ms(policy.periodEnd) &&
        policy.periodStart < policy.periodEnd,
    );
    need(
      source.originAssociation !== null &&
        typeof source.originAssociation === "object" &&
        !isProxy(source.originAssociation),
    );
    need(
      typeof clock.sample === "function" &&
        !isProxy(clock.sample) &&
        typeof clock.subscribeRetirement === "function" &&
        !isProxy(clock.subscribeRetirement),
    );
    // These assertions follow complete own-data validation above. Nothing is taken from a caller API.
    context = Object.freeze({
      basis: Object.freeze({ ...basis }) as unknown as OriginalBasis,
      policy: Object.freeze({ ...policy }) as unknown as Context["policy"],
      sample: clock.sample as Context["sample"],
      clock: source.clock as object,
      originAssociation: source.originAssociation,
    });
    const unsubscribe: unknown = Reflect.apply(
      clock.subscribeRetirement,
      source.clock,
      [close],
    );
    need(typeof unsubscribe === "function" && !isProxy(unsubscribe));
    detachClock = unsubscribe as () => void;
    if (isClosed()) detach();
    need(state === "loading");
    state = "live";
    return context;
  } catch {
    close();
    stop();
  }
}
function check(): Readonly<OriginalSample> {
  if (state === "closed" || checking) {
    close();
    stop();
  }
  checking = true;
  try {
    const current = initialize();
    need(state === "live");
    const raw: unknown = Reflect.apply(current.sample, current.clock, []);
    need(state === "live");
    const value = own(raw, ["wallMs", "ns"]),
      basis = current.basis,
      policy = current.policy;
    need(
      ms(value.wallMs) &&
        ns(value.ns) &&
        value.wallMs >= basis.startWallMs &&
        value.ns >= basis.startNs &&
        value.wallMs < basis.workEndWallMs &&
        value.ns < basis.workEndNs &&
        value.wallMs < basis.endWallMs &&
        value.ns < basis.endNs &&
        (!last || (value.wallMs >= last.wallMs && value.ns >= last.ns)),
    );
    const nowSeconds = Math.floor(value.wallMs / 1000),
      lastSeconds = last ? last.nowSeconds : policy.firstDispatchedAt;
    need(
      Number.isSafeInteger(nowSeconds) &&
        nowSeconds >= lastSeconds &&
        nowSeconds >= policy.firstDispatchedAt &&
        nowSeconds - policy.firstDispatchedAt < 86400 &&
        nowSeconds >= policy.periodStart &&
        nowSeconds < policy.periodEnd,
    );
    need(state === "live");
    const accepted = Object.freeze({
      wallMs: value.wallMs,
      ns: value.ns,
      nowSeconds,
      retired: false as const,
    });
    last = accepted;
    return accepted;
  } catch {
    close();
    stop();
  } finally {
    checking = false;
  }
}
function subscribe(fn: () => void): () => void {
  if (typeof fn !== "function" || isProxy(fn)) {
    close();
    stop();
  }
  if (state !== "closed") {
    try {
      initialize();
    } catch {
      /* Closed listeners are notified below. */
    }
  }
  if (state === "closed") {
    notify(fn);
    return () => {};
  }
  const record = { fn, active: true };
  waiters.add(record);
  return () => {
    if (record.active) {
      record.active = false;
      waiters.delete(record);
    }
  };
}
/** Stable internal identity. Importing it neither loads a Source nor samples a clock. */
export const OWNER = Object.freeze({
  get basis() {
    return initialize().basis;
  },
  check,
  sample: check,
  subscribe,
  retire: close,
});
