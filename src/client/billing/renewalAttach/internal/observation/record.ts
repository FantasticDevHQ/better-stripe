// Bounded record DATA only. Source/ACK identity stays in the invoking actor.
import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import {
  objectNode,
  scalarNode,
  encode,
  materialize,
} from "../material/nodeKernel.js";
import { closed, need, freeze } from "../material/nodeKernel.js";
import { equal, referenceId } from "../../../renewalAggregate/shared.js";
import { observationData } from "./types.js";
import type {
  Node,
  Data,
  ObservationRecord,
  CapturedObservationRecord,
} from "./types.js";
import type { Bundle } from "../material/capture.js";
import type {
  ProjectedRenewalConfigurationV2,
  RenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
const families: Readonly<Record<string, string>> = Object.freeze({
  "/record/request/logicalBinding": "renewal",
  "/record/request/attachReceiptBinding": "renewal-attach-receipt",
  "/record/request/baselineBinding": "renewal-baseline",
  "/record/request/defaultSettingsBinding": "renewal-defaults",
  "/record/request/requestIdentity/binding": "renewal-configure",
  "/record/attachReceipt/logicalBinding": "renewal",
  "/record/attachReceipt/request/logicalBinding": "renewal",
  "/record/attachReceipt/request/requestIdentity/binding": "renewal-attach",
  "/record/attachReceipt/binding": "renewal-attach-receipt",
});
const requestKeys = [
  "version",
  "stage",
  "scope",
  "apiVersion",
  "logicalBinding",
  "scheduleId",
  "method",
  "path",
  "key",
  "payload",
  "firstDispatchedAt",
  "attachReceiptBinding",
  "baselineBinding",
  "defaultSettingsBinding",
  "status",
  "providerQualification",
  "profile",
  "requestIdentity",
];
const schemas: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "": ["record"],
  "/record": ["configuration", "request", "attachReceipt", "originalBundle"],
  "/record/request": requestKeys,
  "/record/request/requestIdentity": ["key", "binding"],
  "/record/request/profile": ["apiVersion", "billingMode", "cadence", "anchor"],
  "/record/attachReceipt": [
    "version",
    "stage",
    "scope",
    "logicalBinding",
    "request",
    "scheduleId",
    "subscriptionId",
    "customerAccountId",
    "livemode",
    "providerSnapshot",
    "binding",
  ],
  "/record/attachReceipt/request": [
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
  ],
  "/record/attachReceipt/request/requestIdentity": ["key", "binding"],
  "/record/originalBundle": [
    "wireSubscription",
    "wireTargetPrice",
    "wireBillingCustomer",
    "couponReads",
    "derivedCouponJoins",
  ],
  "/record/originalBundle/derivedCouponJoins": ["subscription", "item"],
  "/record/configuration/attachReceipt": [
    "attachRequest",
    "actualDispatch",
    "providerSnapshot",
  ],
  "/record/configuration/attachReceipt/attachRequest": [
    "preparation",
    "apiVersion",
    "attachKey",
    "firstDispatchedAt",
  ],
  "/record/configuration/attachReceipt/actualDispatch": [
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
  ],
});
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
function controls(value: unknown, path: string) {
  if (Object.prototype.hasOwnProperty.call(schemas, path))
    closed(value, schemas[path]!);
  if (path === "/record/configuration")
    closed(
      value,
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
  if (
    path === "/record/configuration/preparation" ||
    path === "/record/configuration/attachReceipt/attachRequest/preparation"
  )
    closed(
      value,
      ["subscription", "targetPrice", "expected", "key"],
      ["billingCustomer"],
    );
  if (/^\/record\/originalBundle\/couponReads\/(0|[1-9][0-9]*)$/.test(path))
    closed(value, ["couponId", "wireCoupon", "association"]);
  if (
    /^\/record\/originalBundle\/couponReads\/(0|[1-9][0-9]*)\/association$/.test(
      path,
    )
  )
    closed(value, ["resource", "ordinal"]);
  if (
    /^\/record\/originalBundle\/derivedCouponJoins\/(subscription|item)\/(0|[1-9][0-9]*)$/.test(
      path,
    )
  )
    closed(value, [
      "index",
      "discountId",
      "originalCouponReference",
      "couponReadIndex",
      "joinedDiscount",
    ]);
}
export function captureObservationRecord(
  raw: unknown,
): CapturedObservationRecord {
  const slots = new Map<string, string>(),
    active = new Set<object>();
  let nodes = 0,
    characters = 0;
  function walk(value: unknown, path: string, depth: number): Node {
    need(++nodes <= 10000 && depth <= 40 && !types.isProxy(value));
    if (Object.prototype.hasOwnProperty.call(families, path)) {
      need(
        typeof value === "string" &&
          new RegExp("^" + families[path] + ":v2:sha256:[0-9a-f]{64}$").test(
            value,
          ),
      );
      slots.set(path, value);
      characters += value.length;
      need(characters <= 500000);
      return scalarNode(value);
    }
    if (value === null || typeof value !== "object") {
      requiredJSONSnapshot(value);
      if (typeof value === "string") characters += value.length;
      need(characters <= 500000);
      return scalarNode(value);
    }
    need(!active.has(value));
    active.add(value);
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(value);
    need(keys.length <= 10001);
    controls(value, path);
    const length = array
      ? Object.getOwnPropertyDescriptor(value, "length")
      : null;
    if (array)
      need(
        length &&
          "value" in length &&
          Number.isSafeInteger(length.value) &&
          length.value >= 0 &&
          length.value <= 10000,
      );
    const entries: [string, Node][] = [];
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      characters += key.length;
      need(characters <= 500000);
      need(
        !array ||
          (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length!.value),
      );
      entries.push([key, walk(d.value, path + "/" + pointer(key), depth + 1)]);
    }
    active.delete(value);
    if (array) {
      need(entries.length === length!.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array" as const,
        entries: Object.freeze(
          entries.map(
            Object.freeze as (entry: [string, Node]) => readonly [string, Node],
          ),
        ),
      });
    }
    return objectNode(entries);
  }
  const node = walk({ record: raw }, "", 0);
  need(slots.size === 9);
  encode(node);
  return Object.freeze({
    record: freeze((materialize(node) as { record: ObservationRecord }).record),
    slots,
  });
}
export function verifyObservationRecord(
  captured: CapturedObservationRecord,
  request: ProjectedRenewalConfigurationV2,
  receipt: RenewalScheduleAttachmentReceiptV2,
) {
  const expected = {
    "/record/request/logicalBinding": request.logicalBinding,
    "/record/request/attachReceiptBinding": request.attachReceiptBinding,
    "/record/request/baselineBinding": request.baselineBinding,
    "/record/request/defaultSettingsBinding": request.defaultSettingsBinding,
    "/record/request/requestIdentity/binding": request.requestIdentity.binding,
    "/record/attachReceipt/logicalBinding": receipt.logicalBinding,
    "/record/attachReceipt/request/logicalBinding":
      receipt.request.logicalBinding,
    "/record/attachReceipt/request/requestIdentity/binding":
      receipt.request.requestIdentity.binding,
    "/record/attachReceipt/binding": receipt.binding,
  };
  need(captured.slots.size === 9);
  for (const [path, value] of Object.entries(expected))
    need(captured.slots.get(path) === value);
  const record = captured.record;
  need(equal(record.request, request) && equal(record.attachReceipt, receipt));
  verifyOriginalRaw(record, receipt);
}
const couponID = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 255 &&
  /\S/.test(id) &&
  id !== "." &&
  id !== "..";
function rebuild(
  b: Pick<Bundle, "wireSubscription" | "couponReads" | "derivedCouponJoins">,
) {
  const subscription = b.wireSubscription;
  need(
    subscription &&
      subscription.items &&
      Array.isArray(subscription.items.data) &&
      subscription.items.data.length === 1,
  );
  const lists = [subscription.discounts, subscription.items.data[0]!.discounts];
  need(lists.every((x) => Array.isArray(x) && x.length <= 20));
  need(Array.isArray(b.couponReads) && b.couponReads.length <= 40);
  const ids = new Map<string, number>();
  const joined = lists.map((list) =>
    list.map((discount, index) => {
      need(discount && discount.source);
      const ref = discount.source.coupon,
        id = typeof ref === "string" ? ref : ref?.id;
      need(couponID(id));
      if (!ids.has(id)) {
        const i = ids.size,
          row = closed(b.couponReads[i], [
            "couponId",
            "wireCoupon",
            "association",
          ]);
        const association = closed(row.association, ["resource", "ordinal"]);
        need(
          row.couponId === id &&
            association.resource === "coupon" &&
            association.ordinal === 4 + i,
        );
        const c = observationData(row.wireCoupon);
        need(c && c.id === id && c.object === "coupon" && c.deleted !== true);
        ids.set(id, i);
      }
      const couponReadIndex = ids.get(id)!,
        coupon = b.couponReads[couponReadIndex]!.wireCoupon;
      need(typeof ref === "string" || equal(ref, coupon));
      const joinedDiscount = {
        ...discount,
        source: { ...discount.source, coupon },
      };
      return {
        index,
        discountId: discount.id,
        originalCouponReference: ref,
        couponReadIndex,
        joinedDiscount,
      };
    }),
  );
  need(
    ids.size === b.couponReads.length &&
      equal(b.derivedCouponJoins, { subscription: joined[0], item: joined[1] }),
  );
  return {
    subscription: joined[0]!.map((x) => x.joinedDiscount),
    item: joined[1]!.map((x) => x.joinedDiscount),
  };
}

function association(
  value: unknown,
  id: string,
  configuration: ObservationRecord["configuration"],
) {
  const e = configuration.preparation.expected,
    ctx = { customerAccountId: e.customerAccountId, livemode: e.livemode };
  need(referenceId(value, "sub_sched", "subscription_schedule", ctx) === id);
  if (typeof value === "object")
    need(
      !Object.prototype.hasOwnProperty.call(value as object, "deleted") ||
        (value as Data).deleted === false,
    );
}
function verifyOriginalRaw(
  record: ObservationRecord,
  ack: RenewalScheduleAttachmentReceiptV2,
) {
  const c = record.configuration,
    o = record.originalBundle,
    p = c.preparation,
    a = c.attachReceipt.attachRequest;
  need(
    equal(c.schedule, ack.providerSnapshot) &&
      equal(c.attachReceipt.providerSnapshot, ack.providerSnapshot) &&
      equal(p, a.preparation) &&
      c.apiVersion === a.apiVersion,
  );
  need(
    c.configureKey !== a.attachKey &&
      Object.prototype.hasOwnProperty.call(o.wireSubscription, "schedule") &&
      o.wireSubscription.schedule === null &&
      Object.prototype.hasOwnProperty.call(c.freshSubscription, "schedule") &&
      c.freshSubscription.schedule !== null,
  );
  const { schedule: oldAssociation, ...oldResidual } = o.wireSubscription,
    { schedule: newAssociation, ...newResidual } = c.freshSubscription;
  need(
    oldAssociation === null &&
      equal(oldResidual, newResidual) &&
      equal(p.subscription, o.wireSubscription),
  );
  association(newAssociation, ack.scheduleId, c);
  for (const [name, wire] of [
    ["targetPrice", "wireTargetPrice"],
    ["billingCustomer", "wireBillingCustomer"],
  ] as const)
    need(equal(p[name], o[wire]) && equal(c[name], o[wire]));
  rebuild(o);
  const preconfigure = {
    wireSubscription: c.freshSubscription,
    wireTargetPrice: c.targetPrice,
    wireBillingCustomer: c.billingCustomer,
    couponReads: o.couponReads,
    derivedCouponJoins: o.derivedCouponJoins,
  };
  rebuild(preconfigure);
}
