import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import {
  closed,
  need,
  freeze,
  objectNode,
  scalarNode,
  encode,
  materialize,
  type Node,
} from "../material/nodeKernel.js";
import { equal } from "../../../renewalAggregate/shared.js";
import type { prepareRenewalPriceReplacementV2 } from "../../../renewalV2/index.js";
import type { AttachRequest } from "../operations/types.js";

const materialKeys = [
  "classificationRevision",
  "protocolRevision",
  "stage",
  "intent",
  "scope",
  "apiVersion",
  "profile",
  "quantity",
  "currentPrice",
  "targetPrice",
  "source",
  "nativeItem",
  "billingCustomer",
  "subscriptionDiscounts",
  "itemDiscounts",
  "settings",
  "originalPrepared",
  "completeRequest",
  "stageEvidence",
  "rawSources",
  "freshness",
];
const preparedKeys = [
  "version",
  "scope",
  "expected",
  "quantity",
  "providerSnapshot",
  "status",
  "preservation",
  "requestIdentity",
];
const requestKeys = [
  "version",
  "stage",
  "scope",
  "apiVersion",
  "logicalBinding",
  "method",
  "path",
  "payload",
  "key",
  "firstDispatchedAt",
  "requestIdentity",
];
const slotPaths = [
  "/originalPrepared/requestIdentity/binding",
  "/completeRequest/logicalBinding",
  "/completeRequest/requestIdentity/binding",
  "/retainedMaterial/originalPrepared/requestIdentity/binding",
  "/retainedMaterial/completeRequest/logicalBinding",
  "/retainedMaterial/completeRequest/requestIdentity/binding",
];
const attachSlots = new Set([slotPaths[2], slotPaths[5]]);
export type CapturedRecord = Readonly<{
  node: Node;
  slots: ReadonlyMap<string, string>;
  originalRaw: unknown;
}>;

/** Detached unverified data only. The actor retains and proves its own record. */
export function captureRecoveryRecord(live: unknown): CapturedRecord {
  return captureRecord(live, OWNER);
}
export function captureRecoveryRecordForLineage(
  token: object,
  live: unknown,
): CapturedRecord {
  need(arguments.length === 2);
  return captureRecord(live, ownerForInitialLineage(token));
}
function captureRecord(
  live: unknown,
  owner: { check(): unknown },
): CapturedRecord {
  owner.check();
  const slots = new Map<string, string>(),
    active = new Set<object>();
  let nodes = 0,
    rawChars = 0,
    rawNode: Node | undefined;
  function walk(x: unknown, path: string, depth: number): Node {
    need(++nodes <= 10000 && depth <= 40 && !types.isProxy(x));
    if (slotPaths.includes(path)) {
      need(
        typeof x === "string" &&
          new RegExp(
            "^" +
              (attachSlots.has(path) ? "renewal-attach" : "renewal") +
              ":v2:sha256:[0-9a-f]{64}$",
          ).test(x),
      );
      slots.set(path, x);
      rawChars += x.length;
      need(rawChars <= 500000);
      return scalarNode(x);
    }
    if (x === null || typeof x !== "object") {
      requiredJSONSnapshot(x);
      if (typeof x === "string") rawChars += x.length;
      need(rawChars <= 500000);
      return scalarNode(x);
    }
    need(!active.has(x));
    active.add(x);
    const array = Array.isArray(x),
      proto = Object.getPrototypeOf(x);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(x),
      entries: [string, Node][] = [];
    need(keys.length <= 10001);
    if (path === "")
      closed(x, [
        "originalRaw",
        "originalPrepared",
        "completeRequest",
        "retainedMaterial",
      ]);
    if (path === "/originalRaw") closed(x, ["attachRequest", "originalBundle"]);
    if (
      path === "/originalPrepared" ||
      path === "/retainedMaterial/originalPrepared"
    )
      closed(x, preparedKeys);
    if (
      path === "/completeRequest" ||
      path === "/retainedMaterial/completeRequest"
    )
      closed(x, requestKeys);
    if (path === "/retainedMaterial") closed(x, materialKeys);
    if (path === "/retainedMaterial/rawSources")
      closed(x, ["attachRequest", "intent"]);
    if (path === "/retainedMaterial/stageEvidence")
      closed(x, ["actualFreshSubscription"]);
    if (
      [
        "/originalPrepared/requestIdentity",
        "/completeRequest/requestIdentity",
        "/retainedMaterial/originalPrepared/requestIdentity",
        "/retainedMaterial/completeRequest/requestIdentity",
      ].includes(path)
    )
      closed(x, ["key", "binding"]);
    const length = array ? Object.getOwnPropertyDescriptor(x, "length") : null;
    if (array)
      need(
        length &&
          "value" in length &&
          Number.isSafeInteger(length.value) &&
          length.value <= 10000,
      );
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      rawChars += key.length;
      need(rawChars <= 500000);
      need(
        !array ||
          (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length!.value),
      );
      const child = walk(d.value, path + "/" + key, depth + 1);
      entries.push([key, child]);
      if (path === "" && key === "originalRaw") rawNode = child;
    }
    active.delete(x);
    if (array) {
      need(entries.length === length!.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array",
        entries: Object.freeze(entries.map((e) => Object.freeze(e))),
      });
    }
    return objectNode(entries);
  }
  const node = walk(live, "", 0);
  need(slots.size === 6 && rawNode);
  encode(node);
  owner.check();
  return Object.freeze({
    node,
    slots,
    originalRaw: freeze(materialize(rawNode)),
  });
}

export function verifyRecoveryRecord(
  captured: CapturedRecord,
  prepared: Awaited<ReturnType<typeof prepareRenewalPriceReplacementV2>>,
  request: AttachRequest,
  retained: unknown,
  original: unknown,
): void {
  const expected = [
    prepared.requestIdentity.binding,
    prepared.requestIdentity.binding,
    request.requestIdentity.binding,
    prepared.requestIdentity.binding,
    prepared.requestIdentity.binding,
    request.requestIdentity.binding,
  ];
  slotPaths.forEach((path, i) =>
    need(captured.slots.get(path) === expected[i]),
  );
  const record = closed(materialize(captured.node), [
    "originalRaw",
    "originalPrepared",
    "completeRequest",
    "retainedMaterial",
  ]);
  need(
    equal(record.originalRaw, original) &&
      equal(record.originalPrepared, prepared) &&
      equal(record.completeRequest, request) &&
      equal(record.retainedMaterial, retained),
  );
}
