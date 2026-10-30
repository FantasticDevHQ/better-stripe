// New raw definitions, instantiated before D6/C1; never calls V4 graph factory.
import { INTENT as I } from "./f25.mjs";
import { declaredConfigureWire } from "./f29.mjs";
import { fixture as native } from "./f28.mjs";
import { invoice as invoiceBase } from "./f26.mjs";
import { line as lineBase } from "./f27.mjs";
import { roles } from "./f21.mjs";
const copy = (x) => structuredClone(x);
const freeze = (x) => {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
};
const side = (s) =>
  s === "S"
    ? { sub: I.SUB_SCHEDULED, item: I.ITEM_SCHEDULED }
    : { sub: I.SUB_CONTROL, item: I.ITEM_CONTROL };
function product(role) {
  return {
    id: I["PRODUCT_" + role.toUpperCase()],
    object: "product",
    active: true,
    livemode: false,
    name: I.O + ":" + role,
    metadata: { sdkQualificationRun: I.O, role },
  };
}
function price(role) {
  return {
    id: I["PRICE_" + role.toUpperCase()],
    object: "price",
    type: "recurring",
    active: true,
    unit_amount: I.amounts[role].integer,
    unit_amount_decimal: I.amounts[role].decimal,
    billing_scheme: "per_unit",
    created: 0,
    currency: "usd",
    livemode: false,
    metadata: { sdkQualificationRun: I.O, role },
    nickname: null,
    product: I["PRODUCT_" + role.toUpperCase()],
    tiers_mode: null,
    transform_quantity: null,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
      meter: null,
      trial_period_days: null,
    },
  };
}
function plan(p) {
  return {
    id: p.id,
    object: "plan",
    active: p.active,
    amount: p.unit_amount,
    amount_decimal: p.unit_amount_decimal,
    billing_scheme: p.billing_scheme,
    created: p.created,
    currency: p.currency,
    interval: p.recurring.interval,
    interval_count: p.recurring.interval_count,
    livemode: p.livemode,
    metadata: copy(p.metadata),
    meter: p.recurring.meter,
    nickname: p.nickname,
    product: p.product,
    tiers_mode: p.tiers_mode,
    transform_usage: p.transform_quantity,
    trial_period_days: p.recurring.trial_period_days,
    usage_type: p.recurring.usage_type,
  };
}
function coupon(kind) {
  return {
    id: I["COUPON_" + kind.toUpperCase()],
    object: "coupon",
    created: 0,
    livemode: false,
    duration: "forever",
    duration_in_months: null,
    amount_off: null,
    currency: null,
    percent_off: I.percentOff[kind],
    applies_to: { products: [I.PRODUCT_ORIGINAL, I.PRODUCT_TARGET] },
    max_redemptions: null,
    redeem_by: null,
    times_redeemed: 2,
    valid: true,
    metadata: { sdkQualificationRun: I.O, role: kind },
  };
}
function discount(s, kind) {
  const ids = side(s);
  return {
    id: I["DISCOUNT_" + s + "_" + (kind === "subscription" ? "SUB" : "ITEM")],
    object: "discount",
    checkout_session: null,
    customer: I.MIRROR,
    customer_account: I.BUYER,
    end: null,
    invoice: null,
    invoice_item: null,
    promotion_code: null,
    source: { type: "coupon", coupon: coupon(kind) },
    start: 0,
    subscription: kind === "subscription" ? ids.sub : null,
    subscription_item: kind === "item" ? ids.item : null,
  };
}
function invoice(s, n) {
  const ids = side(s),
    p = price(s === "S" && n === 1 ? "target" : "original"),
    sd = discount(s, "subscription"),
    di = discount(s, "item"),
    identifier =
      I["INVOICE_" + (s === "S" ? "SCHEDULED" : "CONTROL") + "_" + n];
  const line = {
    ...lineBase(),
    id: I["LINE_" + (s === "S" ? "SCHEDULED" : "CONTROL") + "_" + n],
    invoice: identifier,
    subscription: ids.sub,
    discounts: [sd.id, di.id],
    discount_amounts: [{ discount: di.id, amount: 1 }],
    pretax_credit_amounts: [{ type: "discount", discount: sd.id, amount: 1 }],
    parent: {
      type: "subscription_item_details",
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        proration_details: null,
        subscription: ids.sub,
        subscription_item: ids.item,
      },
    },
    period: { start: n === 0 ? I.T0 : I.T1, end: n === 0 ? I.T1 : I.T2 },
    pricing: {
      type: "price_details",
      price_details: { price: p.id, product: p.product },
      unit_amount_decimal: p.unit_amount_decimal,
    },
  };
  return {
    ...invoiceBase(),
    id: identifier,
    customer: I.MIRROR,
    customer_account: I.BUYER,
    test_clock: I.CLOCK,
    discounts: [sd, di],
    currency: "usd",
    billing_reason: n === 0 ? "subscription_create" : "subscription_cycle",
    total_discount_amounts: [{ discount: di.id, amount: 1 }],
    total_pretax_credit_amounts: [
      { type: "discount", discount: sd.id, amount: 1 },
    ],
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { subscription: ids.sub, metadata: {} },
    },
    lines: { object: "list", has_more: false, data: [line] },
  };
}
function substitute(x) {
  if (typeof x === "string") {
    if (x.startsWith("$O:")) return I.O + x.slice(2);
    if (x.startsWith("$")) {
      if (!Object.hasOwn(I, x.slice(1)))
        throw Error("UNDECLARED_INTENT_SYMBOL");
      return copy(I[x.slice(1)]);
    }
    return x;
  }
  if (Array.isArray(x)) return x.map(substitute);
  return x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, substitute(v)]))
    : x;
}
export function instantiateRequired() {
  return instantiate(false);
}
export function instantiateOptional() {
  return instantiate(true);
}
function instantiate(optional) {
  const p = price("original"),
    target = price("target"),
    full = native({
      start: I.T0,
      end: I.T1,
      observedAt: I.OBSERVED,
      subscription: {
        test_clock: I.CLOCK,
        latest_invoice: I.INVOICE_SCHEDULED_0,
        default_payment_method: I.PM_RETURNED,
        billing_mode: copy(I.billingMode),
        metadata: { sdkQualificationRun: I.O, role: "scheduled" },
        discounts: [discount("S", "subscription")],
      },
      item: {
        quantity: 1,
        price: p,
        plan: plan(p),
        discounts: [discount("S", "item")],
      },
      target,
      phaseItem: { quantity: 1 },
      defaults: { default_payment_method: I.PM_RETURNED },
      customer: { test_clock: I.CLOCK },
      schedule: { test_clock: I.CLOCK },
    });
  const sub = copy(full.subscription),
    customer = copy(full.billingCustomer),
    schedule = copy(full.schedule),
    control = {
      ...copy(sub),
      id: I.SUB_CONTROL,
      latest_invoice: I.INVOICE_CONTROL_0,
      metadata: { sdkQualificationRun: I.O, role: "control" },
      discounts: [discount("C", "subscription")],
      items: {
        ...copy(sub.items),
        data: [
          {
            ...copy(sub.items.data[0]),
            id: I.ITEM_CONTROL,
            subscription: I.SUB_CONTROL,
            discounts: [discount("C", "item")],
          },
        ],
      },
    };
  const targetPhase = {
      ...copy(schedule.phases[0]),
      start_date: I.T1,
      end_date: I.T2,
      proration_behavior: "none",
      billing_cycle_anchor: "automatic",
      items: [
        {
          ...copy(schedule.phases[0].items[0]),
          price: I.PRICE_TARGET,
          plan: I.PRICE_TARGET,
        },
      ],
    },
    configured = {
      ...copy(schedule),
      phases: [copy(schedule.phases[0]), targetPhase],
    };
  const activeSub = {
      ...copy(sub),
      latest_invoice: I.INVOICE_SCHEDULED_1,
      schedule: I.SCHEDULE,
      items: {
        ...copy(sub.items),
        data: [
          {
            ...copy(sub.items.data[0]),
            price: target,
            plan: plan(target),
            current_period_start: I.T1,
            current_period_end: I.T2,
          },
        ],
      },
    },
    activeControl = {
      ...copy(control),
      latest_invoice: I.INVOICE_CONTROL_1,
      items: {
        ...copy(control.items),
        data: [
          {
            ...copy(control.items.data[0]),
            current_period_start: I.T1,
            current_period_end: I.T2,
          },
        ],
      },
    };
  const clock = {
      id: I.CLOCK,
      object: "test_helpers.test_clock",
      created: 0,
      deletes_after: 1000,
      frozen_time: I.T0,
      livemode: false,
      name: I.O,
      status: "ready",
      status_details: {},
    },
    buyer = {
      id: I.BUYER,
      object: "v2.core.account",
      livemode: false,
      closed: false,
      metadata: { bts305_bridge_owner: I.O },
      applied_configurations: ["customer"],
      configuration: { customer: { applied: true, test_clock: I.CLOCK } },
    };
  const bodyAt = (stage, name) => {
    if (stage === "creation") {
      const m = {
        clock,
        buyer,
        originalProduct: product("original"),
        targetProduct: product("target"),
        originalPrice: p,
        targetPrice: target,
        subscriptionCoupon: coupon("subscription"),
        itemCoupon: coupon("item"),
        scheduledSubscription: sub,
        controlSubscription: control,
      };
      if (!Object.hasOwn(m, name)) throw Error("UNKNOWN_CREATION_ROLE");
      return copy(m[name]);
    }
    if (name === "billingCustomer") return copy(customer);
    if (name === "targetPrice") return copy(target);
    if (name === "subscriptionCoupon") return coupon("subscription");
    if (name === "itemCoupon") return coupon("item");
    if (name === "mirrorInventory")
      return {
        synthetic: true,
        object: "list",
        has_more: false,
        data: [copy(customer)],
      };
    if (name === "schedule")
      return stage === "active"
        ? {
            ...copy(configured),
            current_phase: { start_date: I.T1, end_date: I.T2 },
          }
        : copy(configured);
    if (name === "scheduledSubscription")
      return stage === "active"
        ? copy(activeSub)
        : { ...copy(sub), schedule: stage === "pending" ? I.SCHEDULE : null };
    if (name === "controlSubscription")
      return stage === "active" ? copy(activeControl) : copy(control);
    for (const [s, prefix] of [
      ["S", "scheduled"],
      ["C", "control"],
    ]) {
      const n = stage === "active" ? 1 : 0;
      if (name === prefix + "Inventory")
        return {
          object: "list",
          has_more: false,
          data: n === 0 ? [invoice(s, 0)] : [invoice(s, 0), invoice(s, 1)],
        };
      if (name === prefix + "Lines") return invoice(s, n).lines;
      if (name === prefix + "Invoice") return invoice(s, n);
    }
    if (name === "nativeAdvance")
      return {
        ...copy(clock),
        status: "advancing",
        status_details: { advancing: { target_frozen_time: I.T1 } },
      };
    if (name === "clockReady")
      return {
        ...copy(clock),
        frozen_time: optional ? I.F1_UNVERIFIED_NATIVE_TARGET : I.T1,
      };
    if (name === "nativeReadyBeforeFinalization")
      return { ...copy(clock), frozen_time: I.T1 };
    if (name === "finalizationAdvance")
      return {
        ...copy(clock),
        status: "advancing",
        frozen_time: I.T1,
        status_details: {
          advancing: { target_frozen_time: I.F1_UNVERIFIED_NATIVE_TARGET },
        },
      };
    throw Error("UNKNOWN_LATER_ROLE");
  };
  const rows = { creation: {}, baseline: {}, pending: {}, active: {} };
  for (const role of roles) {
    if (!role.required && !optional) continue;
    const [, stage, name] = role.pointer.split("/").slice(1),
      request = {
        method: role.method,
        path: role.pathTemplate.replace(/\$[A-Z_0-9]+/g, (s) => {
          if (!Object.hasOwn(I, s.slice(1)))
            throw Error("UNDECLARED_INTENT_SYMBOL");
          return encodeURIComponent(I[s.slice(1)]);
        }),
        apiVersion: I.API_VERSION,
        scope: "platform",
        ...(role.method === "POST"
          ? { params: substitute(role.paramsTemplate) }
          : {}),
      };
    rows[stage][name] = {
      request,
      response: { status: 200, requestId: null, body: bodyAt(stage, name) },
    };
  }
  const setup = {
      id: I.SETUP,
      object: "setup_intent",
      created: I.T0,
      customer: I.MIRROR,
      customer_account: I.BUYER,
      livemode: false,
      status: "succeeded",
      payment_method: I.PM_RETURNED,
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { sdkQualificationRun: I.O },
    },
    pm = {
      id: I.PM_RETURNED,
      object: "payment_method",
      created: I.T0,
      type: "card",
      livemode: false,
      customer: I.MIRROR,
      customer_account: I.BUYER,
      card: {
        brand: "visa",
        display_brand: "visa",
        country: "US",
        funding: "credit",
        exp_month: 12,
        exp_year: 2030,
        last4: "4242",
        checks: {
          address_line1_check: null,
          address_postal_code_check: null,
          cvc_check: null,
        },
        networks: { available: ["visa"], preferred: null },
        three_d_secure_usage: { supported: true },
        regulated_status: null,
        wallet: null,
        generated_from: null,
      },
    };
  const privateBodies = {
    R01: { id: I.PLATFORM, object: "account", deleted: false, livemode: false },
    R02: copy(buyer),
    R04: copy(customer),
    P03: setup,
    R05: pm,
  };
  const preparation = {
    subscription: copy(sub),
    targetPrice: copy(target),
    billingCustomer: copy(customer),
    expected: copy(full.expected),
    key: I.LOGICAL_KEY,
  };
  const attach = {
    attachRequest: {
      preparation: copy(preparation),
      apiVersion: I.API_VERSION,
      attachKey: I.ATTACH_KEY,
      firstDispatchedAt: I.ATTACH_FIRST_DISPATCHED_AT,
    },
    actualDispatch: {
      scope: "platform",
      apiVersion: I.API_VERSION,
      method: "POST",
      path: "/v1/subscription_schedules",
      payload: { from_subscription: I.SUB_SCHEDULED },
      key: I.ATTACH_KEY,
      firstDispatchedAt: I.ATTACH_FIRST_DISPATCHED_AT,
    },
    providerSnapshot: copy(schedule),
  };
  const configuration = {
    preparation: copy(preparation),
    attachReceipt: copy(attach),
    freshSubscription: { ...copy(sub), schedule: I.SCHEDULE },
    targetPrice: copy(target),
    billingCustomer: copy(customer),
    schedule: copy(schedule),
    apiVersion: I.API_VERSION,
    observedAt: I.OBSERVED,
    firstDispatchedAt: I.CONFIGURE_FIRST_DISPATCHED_AT,
    configureKey: I.CONFIGURE_KEY,
  };
  return freeze({
    rows,
    privateBodies,
    preparation,
    attach,
    configuration,
    configuredBody: copy(configured),
    configuredDispatch: declaredConfigureWire,
    intent: I,
    syntheticOnly: true,
    actualFulfillment: false,
    financialQualified: false,
  });
}
