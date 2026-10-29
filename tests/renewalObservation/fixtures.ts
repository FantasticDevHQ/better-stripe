import { fixture, nativePlanForPrice } from "./native-fixture.js";
// Full synthetic native material, not an observed provider renewal or receipt.
export function observationInput(
  active = false,
  weekly = true,
  targetCount = 1,
) {
  const f = fixture({
    targetInterval: weekly ? "week" : "month",
    targetCount,
    subscription: {
      latest_invoice: "in_original",
      trial_start: null,
      trial_end: null,
    },
  });
  const preparation = {
    subscription: f.subscription,
    targetPrice: f.targetPrice,
    billingCustomer: f.billingCustomer,
    expected: f.prepared.expected,
    key: f.prepared.requestIdentity.key,
  };
  const a = f.attachRequest;
  const configuration = {
    preparation,
    attachReceipt: {
      attachRequest: {
        preparation: structuredClone(preparation),
        apiVersion: a.apiVersion,
        attachKey: a.key,
        firstDispatchedAt: a.firstDispatchedAt,
      },
      actualDispatch: {
        scope: "platform" as const,
        apiVersion: a.apiVersion,
        method: "POST" as const,
        path: "/v1/subscription_schedules" as const,
        payload: a.payload,
        key: a.key,
        firstDispatchedAt: a.firstDispatchedAt,
      },
      providerSnapshot: structuredClone(f.schedule),
    },
    freshSubscription: f.configureInput.freshSubscription,
    targetPrice: f.targetPrice,
    billingCustomer: f.billingCustomer,
    schedule: structuredClone(f.schedule),
    apiVersion: a.apiVersion,
    observedAt: f.configureInput.observedAt,
    firstDispatchedAt: f.configureInput.firstDispatchedAt,
    configureKey: f.configureInput.configureKey,
  };
  const start = f.prepared.expected.periodEnd,
    end = start + (weekly ? 604800 * targetCount : 2419200);
  const current = structuredClone(f.schedule.phases[0]),
    target = structuredClone(current);
  target.start_date = start;
  target.end_date = end;
  Object.assign(target, {
    billing_cycle_anchor: weekly ? "phase_start" : "automatic",
  });
  target.proration_behavior = "none";
  target.items[0].price = "price_target";
  target.items[0].plan = "price_target";
  const schedule = {
    ...structuredClone(f.schedule),
    phases: [current, target],
    current_phase: active
      ? { start_date: start, end_date: end }
      : f.schedule.current_phase,
  };
  const subscription = structuredClone(f.subscription);
  Object.assign(subscription, { schedule: schedule.id });
  if (active) {
    const item = subscription.items.data[0];
    item.id = "si_successor";
    item.price = structuredClone(f.targetPrice);
    item.plan = nativePlanForPrice(f.targetPrice);
    item.current_period_start = start;
    item.current_period_end = end;
    item.discounts[0].subscription_item = item.id;
    if (weekly) subscription.billing_cycle_anchor = start;
  }
  return {
    configuration,
    reads: {
      schedule,
      subscription,
      targetPrice: structuredClone(f.targetPrice),
      billingCustomer: structuredClone(f.billingCustomer),
      coupons: structuredClone([
        f.subscription.discounts[0].source.coupon,
        f.originalItem.discounts[0].source.coupon,
      ]),
    },
  };
}
