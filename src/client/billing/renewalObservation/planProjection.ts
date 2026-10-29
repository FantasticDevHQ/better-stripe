import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  equal,
  productId,
  type ReferenceContext,
} from "../renewalAggregate/shared.js";
type O = Record<string, unknown>;
const record = (x: unknown): x is O =>
  !!x && typeof x === "object" && !Array.isArray(x);
const owns = (x: O, k: string) => Object.prototype.hasOwnProperty.call(x, k);
const minimalProduct = (x: O) =>
  Object.keys(x).every((k) =>
    ["id", "object", "deleted", "livemode", "customer_account"].includes(k),
  ) &&
  (x.deleted === undefined || x.deleted === false);
const PLAN_KEYS = [
  "id",
  "object",
  "active",
  "amount",
  "amount_decimal",
  "billing_scheme",
  "created",
  "currency",
  "interval",
  "interval_count",
  "livemode",
  "metadata",
  "meter",
  "nickname",
  "product",
  "tiers_mode",
  "transform_usage",
  "trial_period_days",
  "usage_type",
];
const PRICE_KEYS = [
  "id",
  "object",
  "active",
  "unit_amount",
  "unit_amount_decimal",
  "billing_scheme",
  "created",
  "currency",
  "livemode",
  "metadata",
  "nickname",
  "product",
  "tiers_mode",
  "transform_quantity",
  "recurring",
];
const REC_KEYS = [
  "interval",
  "interval_count",
  "usage_type",
  "meter",
  "trial_period_days",
];
/** Finite validation-view template only. No provider Plan or financial calculation is invented. */
export function planTemplateForPrice(
  value: unknown,
  context: ReferenceContext,
): O | null {
  try {
    if (
      !record(value) ||
      !PRICE_KEYS.every((k) => owns(value, k)) ||
      !record(value.recurring) ||
      !REC_KEYS.every((k) => owns(value.recurring as O, k))
    )
      return null;
    const p = value,
      r = value.recurring;
    if (
      p.object !== "price" ||
      typeof p.id !== "string" ||
      !/^price_[A-Za-z0-9_]+$/.test(p.id) ||
      typeof p.active !== "boolean" ||
      p.livemode !== context.livemode ||
      p.billing_scheme !== "per_unit" ||
      !["day", "week", "month", "year"].includes(String(r.interval)) ||
      !Number.isSafeInteger(r.interval_count) ||
      Number(r.interval_count) <= 0 ||
      r.usage_type !== "licensed" ||
      r.meter !== null ||
      r.trial_period_days !== null ||
      p.tiers_mode !== null ||
      p.transform_quantity !== null ||
      owns(p, "tiers")
    )
      return null;
    if (
      !Number.isSafeInteger(p.created) ||
      Number(p.created) < 0 ||
      typeof p.currency !== "string" ||
      !/^[a-z]{3}$/.test(p.currency) ||
      (p.nickname !== null && typeof p.nickname !== "string") ||
      !record(p.metadata) ||
      !Object.values(p.metadata).every((x) => typeof x === "string")
    )
      return null;
    if (
      p.unit_amount !== null &&
      (!Number.isSafeInteger(p.unit_amount) || Number(p.unit_amount) < 0)
    )
      return null;
    if (
      p.unit_amount_decimal !== null &&
      (typeof p.unit_amount_decimal !== "string" ||
        !/^\d+(?:\.\d{1,12})?$/.test(p.unit_amount_decimal))
    )
      return null;
    if (p.unit_amount === null && p.unit_amount_decimal === null) return null;
    productId(p.product, context);
    return renewalSnapshot({
      id: p.id,
      object: "plan",
      active: p.active,
      amount: p.unit_amount,
      amount_decimal: p.unit_amount_decimal,
      billing_scheme: p.billing_scheme,
      created: p.created,
      currency: p.currency,
      interval: r.interval,
      interval_count: r.interval_count,
      livemode: p.livemode,
      metadata: p.metadata,
      meter: r.meter,
      nickname: p.nickname,
      product: p.product,
      tiers_mode: p.tiers_mode,
      transform_usage: p.transform_quantity,
      trial_period_days: r.trial_period_days,
      usage_type: r.usage_type,
    });
  } catch {
    return null;
  }
}
/** Every native Plan field is required and mapped exactly; unknown/unmapped facts reject. */
export function planMatchesPrice(
  value: unknown,
  price: unknown,
  context: ReferenceContext,
): boolean {
  try {
    const expected = planTemplateForPrice(price, context);
    if (
      !expected ||
      !record(value) ||
      Object.keys(value).length !== PLAN_KEYS.length ||
      !PLAN_KEYS.every((k) => owns(value, k))
    )
      return false;
    if (value.object !== "plan") return false;
    const actual = renewalSnapshot(value),
      template = renewalSnapshot(expected);
    const id = productId(actual.product, context),
      wanted = productId(template.product, context);
    if (id !== wanted) return false;
    if (record(actual.product) && !minimalProduct(actual.product)) {
      if (
        !record(template.product) ||
        minimalProduct(template.product) ||
        !equal(actual.product, template.product)
      )
        return false;
    }
    actual.product = id;
    template.product = wanted;
    return equal(actual, template);
  } catch {
    return false;
  }
}
