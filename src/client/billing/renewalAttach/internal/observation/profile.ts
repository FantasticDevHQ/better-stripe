import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import type {
  Data,
  ObservationRecord,
  ObservationReadRow,
  ObservationReads,
  Resource,
} from "./types.js";
const API = "2026-09-30.endive";
const need: (x: unknown) => asserts x = (x) => {
  if (!x) throw Error("OWNED_OBSERVATION_STOP");
};
function object(x: unknown): Data {
  need(
    x !== null &&
      typeof x === "object" &&
      !types.isProxy(x) &&
      !Array.isArray(x),
  );
  const p = Object.getPrototypeOf(x);
  need(p === Object.prototype || p === null);
  return x as Data;
}
function own(x: unknown, key: string): unknown {
  object(x);
  const d = Object.getOwnPropertyDescriptor(x, key);
  need(d && d.enumerable && "value" in d);
  return d.value;
}
function resourceID(value: unknown, prefix: string): string {
  need(
    typeof value === "string" &&
      value.length <= 255 &&
      new RegExp("^" + prefix + "_[A-Za-z0-9_]+$").test(value),
  );
  requiredJSONSnapshot(value);
  return value;
}
function reference(
  value: unknown,
  prefix: string,
  kind: string,
  context: ReturnType<typeof ids>,
) {
  if (typeof value === "string") return resourceID(value, prefix);
  need(
    own(value, "object") === kind &&
      (!Object.prototype.hasOwnProperty.call(value as object, "deleted") ||
        own(value, "deleted") === false),
  );
  if (Object.prototype.hasOwnProperty.call(value as object, "livemode"))
    need(own(value, "livemode") === context.livemode);
  if (Object.prototype.hasOwnProperty.call(value as object, "customer_account"))
    need(own(value, "customer_account") === context.account);
  return resourceID(own(value, "id"), prefix);
}
function ids(record: ObservationRecord) {
  const e = record.configuration.preparation.expected;
  need(
    record.request.scope === "platform" && record.request.apiVersion === API,
  );
  return {
    schedule: resourceID(record.attachReceipt.scheduleId, "sub_sched"),
    subscription: resourceID(e.subscriptionId, "sub"),
    price: resourceID(e.targetPriceId, "price"),
    customer: resourceID(record.originalBundle.wireBillingCustomer.id, "cus"),
    account: e.customerAccountId,
    livemode: e.livemode,
  };
}
function row(
  resource: Resource,
  id: string,
  ordinal: number,
): ObservationReadRow {
  const segments = {
    schedule: "subscription_schedules",
    subscription: "subscriptions",
    price: "prices",
    customer: "customers",
    coupon: "coupons",
  };
  const query =
    resource === "subscription"
      ? "?" +
        String(
          new URLSearchParams([
            ["expand[0]", "discounts"],
            ["expand[1]", "items.data.discounts"],
            ["expand[2]", "items.data.price"],
          ]),
        )
      : "";
  return Object.freeze({
    resource,
    id,
    ordinal,
    method: "GET",
    path: "/v1/" + segments[resource] + "/" + encodeURIComponent(id) + query,
    body: undefined,
    options: Object.freeze({ apiVersion: API, maxNetworkRetries: 0 }),
  });
}
export function baseReadRows(record: ObservationRecord) {
  const p = ids(record);
  return Object.freeze([
    row("schedule", p.schedule, 1),
    row("subscription", p.subscription, 2),
    row("price", p.price, 3),
    row("customer", p.customer, 4),
  ]);
}
function soleItem(subscription: unknown) {
  const items = own(subscription, "items"),
    values = own(items, "data");
  need(
    own(items, "has_more") === false &&
      Array.isArray(values) &&
      values.length === 1,
  );
  const item = object(values[0]);
  resourceID(own(item, "id"), "si");
  return item;
}
export function validateBaseRouting(
  record: ObservationRecord,
  reads: ObservationReads,
) {
  const p = ids(record),
    s = object(reads.schedule),
    sub = object(reads.subscription),
    price = object(reads.targetPrice),
    customer = object(reads.billingCustomer);
  need(
    own(s, "id") === p.schedule &&
      own(s, "object") === "subscription_schedule" &&
      s.deleted !== true,
  );
  need(
    own(sub, "id") === p.subscription &&
      own(sub, "object") === "subscription" &&
      sub.deleted !== true,
  );
  need(
    own(price, "id") === p.price &&
      own(price, "object") === "price" &&
      price.deleted !== true,
  );
  need(
    own(customer, "id") === p.customer &&
      own(customer, "object") === "customer" &&
      customer.deleted !== true,
  );
  for (const body of [s, sub, customer])
    need(
      own(body, "customer_account") === p.account &&
        own(body, "livemode") === p.livemode,
    );
  need(own(price, "livemode") === p.livemode);
  need(
    reference(own(s, "customer"), "cus", "customer", p) === p.customer &&
      reference(own(sub, "customer"), "cus", "customer", p) === p.customer,
  );
  if (own(s, "subscription") !== null)
    need(
      reference(s.subscription, "sub", "subscription", p) === p.subscription,
    );
  if (own(sub, "schedule") !== null)
    need(
      reference(sub.schedule, "sub_sched", "subscription_schedule", p) ===
        p.schedule,
    );
  const item = soleItem(sub);
  need(own(item, "subscription") === p.subscription);
  // Do not constrain status, current price, old item ID/period, phases or material
  // equality here. The unchanged public observer decides those data relations.
}
function couponID(value: unknown): string {
  need(
    typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 255 &&
      /\S/.test(value) &&
      value !== "." &&
      value !== "..",
  );
  requiredJSONSnapshot(value);
  return value;
}
export function observationCouponIds(
  record: ObservationRecord,
  currentSubscription: unknown,
) {
  const p = ids(record),
    original = record.originalBundle.wireSubscription;
  const oldItem = soleItem(original),
    currentItem = soleItem(currentSubscription);
  const groups: readonly (readonly [unknown, Data, "subscription" | "item"])[] =
    [
      [original, oldItem, "subscription"],
      [oldItem, oldItem, "item"],
      [currentSubscription, currentItem, "subscription"],
      [currentItem, currentItem, "item"],
    ];
  const result: string[] = [],
    seen = new Set<string>();
  for (const [owner, item, level] of groups) {
    const discounts = own(owner, "discounts");
    need(Array.isArray(discounts) && discounts.length <= 20);
    for (const value of discounts as readonly unknown[]) {
      const d = object(value);
      resourceID(own(d, "id"), "di");
      need(
        own(d, "object") === "discount" &&
          d.deleted !== true &&
          own(d, "customer_account") === p.account,
      );
      if (Object.prototype.hasOwnProperty.call(d, "customer"))
        need(
          reference(own(d, "customer"), "cus", "customer", p) === p.customer,
        );
      if (level === "subscription")
        need(
          own(d, "subscription") === p.subscription &&
            own(d, "subscription_item") === null,
        );
      else
        need(
          own(d, "subscription_item") === item.id &&
            (own(d, "subscription") === null ||
              d.subscription === p.subscription),
        );
      const source = own(d, "source");
      need(own(source, "type") === "coupon");
      const raw = own(source, "coupon"),
        id = couponID(typeof raw === "string" ? raw : own(raw, "id"));
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }
  need(result.length <= 40);
  return Object.freeze(result);
}
export function couponReadRow(id: unknown, ordinal: number) {
  need(Number.isSafeInteger(ordinal) && ordinal >= 5 && ordinal <= 44);
  return row("coupon", couponID(id), ordinal);
}
export function validateCoupon(
  record: ObservationRecord,
  id: string,
  body: unknown,
) {
  const p = ids(record);
  object(body);
  need(
    own(body, "id") === id &&
      own(body, "object") === "coupon" &&
      (body as Data).deleted !== true &&
      own(body, "livemode") === p.livemode,
  );
}
