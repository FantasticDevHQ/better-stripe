import type { createReadLifetime } from "./readLifetime.js";
import type { createSourceStockRawDelegate } from "../stockRawDelegate.js";
export type Resource = "subscription" | "price" | "customer" | "coupon";
export type Read = ReturnType<typeof bindWireSource>;
import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { resourceId } from "../../../renewalAggregate/shared.js";
const stop = () => {
  throw Error("RAW_ACQUISITION_STOP");
};
const need: (x: unknown) => asserts x = (x) => {
  if (!x) stop();
};
const specs = Object.freeze({
  subscription: ["subscriptions", resourceId("sub")],
  price: ["prices", resourceId("price")],
  customer: ["customers", resourceId("cus")],
  coupon: ["coupons", null],
} as const);
const expansions = ["discounts", "items.data.discounts", "items.data.price"];
// Fixed pinned Node intrinsics, captured before any reply; not a provenance assertion.
const nativeResponsePrototype = Response.prototype,
  nativeStatusGetter = Object.getOwnPropertyDescriptor(
    nativeResponsePrototype,
    "status",
  )!.get!,
  apply = Reflect.apply,
  isProxy = types.isProxy;
function selectedID(resource: Resource, id: string) {
  const spec = specs[resource];
  need(spec);
  if (spec[1]) return spec[1].parse(id);
  need(
    typeof id === "string" &&
      id.length >= 1 &&
      id.length <= 255 &&
      /\S/.test(id) &&
      id !== "." &&
      id !== "..",
  );
  return id;
}
// Unsupported Proxies are rejected BEFORE any trap-capable JSON reflection.
// Count every occurrence, while removing active-path entries so repeated values may pass.
export function rejectProxyJSON(value: unknown, transportRoot = false) {
  const active = new Set<object>();
  let nodes = 0;
  function walk(x: unknown, depth: number, isRoot: boolean): void {
    need(++nodes <= 10000 && depth <= 40);
    need(!isProxy(x));
    if (x === null || typeof x !== "object") return;
    need(!active.has(x));
    active.add(x);
    const array = Array.isArray(x),
      keys = Reflect.ownKeys(x);
    need(keys.length <= 10001);
    for (const key of keys) {
      need(typeof key === "string");
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && "value" in d);
      if (isRoot && transportRoot && key === "lastResponse" && !d.enumerable)
        continue;
      if (array && key === "length") continue;
      need(d.enumerable);
      walk(d.value, depth + 1, false);
    }
    active.delete(x);
  }
  walk(value, 0, true);
}
function captureReply(reply: unknown): Record<string, unknown> {
  rejectProxyJSON(reply, true);
  need(reply !== null && typeof reply === "object" && !Array.isArray(reply));
  const proto = Object.getPrototypeOf(reply);
  need(proto === Object.prototype || proto === null);
  const meta = Object.getOwnPropertyDescriptor(reply, "lastResponse");
  need(
    meta &&
      !meta.enumerable &&
      "value" in meta &&
      meta.value !== null &&
      typeof meta.value === "object",
  );
  const metadata = meta.value;
  need(!isProxy(metadata));
  const codes: unknown[] = [];
  for (const key of ["status", "statusCode"]) {
    const d = Object.getOwnPropertyDescriptor(metadata, key);
    if (!d) continue;
    need("value" in d);
    if (d.value !== undefined) codes.push(d.value);
  }
  if (Object.getPrototypeOf(metadata) === nativeResponsePrototype)
    codes.push(apply(nativeStatusGetter, metadata, []));
  need(
    codes.length > 0 &&
      codes.every(
        (x) =>
          typeof x === "number" &&
          Number.isInteger(x) &&
          x >= 200 &&
          x < 300 &&
          x === codes[0],
      ),
  );
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(reply)) {
    need(typeof key === "string");
    if (key === "lastResponse") continue;
    const d = Object.getOwnPropertyDescriptor(reply, key);
    need(d && d.enumerable && "value" in d);
    entries.push([key, d.value]);
  }
  return requiredJSONSnapshot(Object.fromEntries(entries)) as Record<
    string,
    unknown
  >;
}
// Fixed Source transport only. Never await the old helper, which reflects before caller resumes.
export function bindWireSource(
  sourceTransport: ReturnType<typeof createSourceStockRawDelegate>,
  lifetime: ReturnType<typeof createReadLifetime>,
) {
  return async function read(resource: Resource, id: string) {
    const selected = selectedID(resource, id),
      query =
        resource === "subscription"
          ? "?" +
            new URLSearchParams(
              expansions.map((v, i) => ["expand[" + i + "]", v]),
            )
          : "";
    lifetime.check();
    let reply;
    try {
      reply = await sourceTransport.rawRequest(
        "GET",
        "/v1/" +
          specs[resource][0] +
          "/" +
          encodeURIComponent(selected) +
          query,
        undefined,
        { apiVersion: "2026-09-30.endive", maxNetworkRetries: 0 },
      );
    } catch {
      lifetime.check();
      stop();
    }
    // FIRST action after fulfillment: no body or metadata access may precede this guard.
    lifetime.check();
    const body = captureReply(reply);
    lifetime.check();
    return body;
  };
}
