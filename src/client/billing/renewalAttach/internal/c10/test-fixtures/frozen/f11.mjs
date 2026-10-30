import { requiredJSONSnapshot } from "./f15.mjs";
import { objectNode, scalarNode, encode, materialize } from "./f14.mjs";
import { need, closed, freeze } from "./f17.mjs";
const expected = [
  "customerAccountId",
  "subscriptionId",
  "itemId",
  "currentPriceId",
  "currentProductId",
  "targetPriceId",
  "targetProductId",
  "periodStart",
  "periodEnd",
  "livemode",
];
function preparation(x) {
  const p = closed(
    x,
    ["subscription", "targetPrice", "expected", "key"],
    ["billingCustomer"],
  );
  closed(p.expected, expected);
  need(typeof p.key === "string");
}
function attach(x) {
  const a = closed(x, [
    "preparation",
    "apiVersion",
    "attachKey",
    "firstDispatchedAt",
  ]);
  preparation(a.preparation);
  need(
    typeof a.apiVersion === "string" &&
      typeof a.attachKey === "string" &&
      typeof a.firstDispatchedAt === "number",
  );
}
function receipt(x) {
  const r = closed(x, ["attachRequest", "actualDispatch", "providerSnapshot"]);
  attach(r.attachRequest);
  closed(r.actualDispatch, [
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
  ]);
}
function configuration(x) {
  const c = closed(
    x,
    [
      "preparation",
      "attachReceipt",
      "freshSubscription",
      "targetPrice",
      "schedule",
      "apiVersion",
      "observedAt",
      "firstDispatchedAt",
      "configureKey",
    ],
    ["billingCustomer"],
  );
  preparation(c.preparation);
  receipt(c.attachReceipt);
  need(
    typeof c.apiVersion === "string" &&
      typeof c.observedAt === "number" &&
      typeof c.firstDispatchedAt === "number" &&
      typeof c.configureKey === "string",
  );
}
function shape(x, stage, fresh) {
  const configure = stage === "configure";
  const root = configure ? "configuration" : "attachRequest";
  const a = closed(x, [
    root,
    "intent",
    ...(fresh
      ? [
          "freshSubscription",
          "targetPrice",
          "billingCustomer",
          ...(configure ? ["schedule"] : []),
          "observedAt",
        ]
      : []),
  ]);
  need(a.intent === "initial" || (!configure && a.intent === "replay_unknown"));
  if (fresh)
    need(
      typeof a.observedAt === "number" &&
        Number.isSafeInteger(a.observedAt) &&
        a.observedAt >= 0,
    );
  (configure ? configuration : attach)(a[root]);
}
export function captureRaw(value, stage, fresh) {
  shape(value, stage, fresh);
  // Original whole ordinary admission precedes any clone/encoding. Discard array reflection order.
  requiredJSONSnapshot(value);
  let nodes = 0,
    raw = 0;
  const active = new Set();
  function scalar(x) {
    requiredJSONSnapshot(x);
    if (typeof x === "string") raw += x.length;
    need(raw <= 500000);
    return scalarNode(x);
  }
  function walk(x, depth) {
    need(++nodes <= 10000 && depth <= 40);
    if (x === null || typeof x !== "object") return scalar(x);
    need(!active.has(x));
    const array = Array.isArray(x),
      proto = Object.getPrototypeOf(x);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(x);
    need(keys.every((k) => typeof k === "string"));
    const length = array ? Object.getOwnPropertyDescriptor(x, "length") : null;
    if (array)
      need(
        length &&
          "value" in length &&
          Number.isSafeInteger(length.value) &&
          length.value >= 0 &&
          length.value <= 10000,
      );
    const entries = [];
    active.add(x);
    for (const key of keys) {
      if (array && key === "length") continue;
      need(
        !array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length.value),
      );
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      requiredJSONSnapshot(key);
      raw += key.length;
      need(raw <= 500000);
      entries.push([key, walk(d.value, depth + 1)]);
    }
    active.delete(x);
    if (array) {
      need(entries.length === length.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array",
        entries: Object.freeze(entries.map(Object.freeze)),
      });
    }
    return objectNode(entries);
  }
  const node = walk(value, 0);
  encode(node);
  const detached = materialize(node);
  shape(detached, stage, fresh);
  const plain = requiredJSONSnapshot(detached);
  shape(plain, stage, fresh);
  return freeze(plain);
}
