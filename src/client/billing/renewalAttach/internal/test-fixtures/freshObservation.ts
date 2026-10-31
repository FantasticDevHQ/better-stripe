import { vi } from "vitest";
import { admissionControls } from "./producerConfigureAdmission.js";
import {
  prepareObservationReader,
  readerControls,
} from "./observationReader.js";
// Fixed synthetic native month boundaries. These are test DATA, never host date math.
function targetSchedule(original: Record<string, unknown>, weekly: boolean) {
  const schedule = structuredClone(original);
  const phases = schedule.phases as Record<string, unknown>[];
  const current = phases[0],
    target = structuredClone(current);
  target.start_date = current.end_date;
  target.end_date = weekly ? 1771718400 : 1773532800;
  target.billing_cycle_anchor = weekly ? "phase_start" : "automatic";
  target.proration_behavior = "none";
  const items = target.items as Record<string, unknown>[];
  items[0].price = "price_target";
  items[0].plan = "price_target";
  schedule.phases = [current, target];
  return schedule;
}
export async function prepareFreshObservation(
  h: Parameters<typeof prepareObservationReader>[0],
  options: { active?: boolean; retained?: boolean } = {},
) {
  const state = await prepareObservationReader(h, {
    write: options.retained === true,
    beforeWrite() {
      const pending = targetSchedule(
        h.baseline.schedule,
        String(
          h.baseline.original.attachRequest.preparation.targetPrice.recurring
            .interval,
        ) === "week",
      );
      Object.assign(h.baseline.schedule, pending);
    },
  });
  const configuration = JSON.parse(state.full.configure.operation.recordJSON)
    .configureRecord.configuration;
  const weekly = configuration.targetPrice.recurring.interval === "week";
  const schedule = targetSchedule(configuration.schedule, weekly);
  const subscription = structuredClone(configuration.freshSubscription);
  const price = structuredClone(configuration.targetPrice);
  const customer = structuredClone(configuration.billingCustomer);
  const target = (schedule.phases as Record<string, unknown>[])[1];
  if (options.active) {
    schedule.current_phase = {
      start_date: target.start_date,
      end_date: target.end_date,
    };
    const item = subscription.items.data[0];
    item.id = "si_successor";
    item.price = structuredClone(price);
    Object.assign(item.plan, {
      id: price.id,
      amount: price.unit_amount,
      amount_decimal: price.unit_amount_decimal,
      product: price.product,
      metadata: price.metadata,
      nickname: price.nickname,
      interval: price.recurring.interval,
      interval_count: price.recurring.interval_count,
    });
    item.current_period_start = target.start_date;
    item.current_period_end = target.end_date;
    for (const discount of item.discounts) discount.subscription_item = item.id;
    if (weekly) subscription.billing_cycle_anchor = target.start_date;
  } else vi.setSystemTime((configuration.firstDispatchedAt + 1000) * 1000);
  readerControls.grant.expiresAtMs = Date.now() + 60000;
  const reads = {
    schedule,
    subscription,
    targetPrice: price,
    billingCustomer: customer,
    coupons: [] as unknown[],
  };
  h.setControlledRead("/v1/subscription_schedules/sub_sched_owned", schedule);
  h.setControlledRead("/v1/subscriptions/sub_original", subscription);
  h.setControlledRead("/v1/prices/price_target", price);
  h.setControlledRead("/v1/customers/cus_buyer", customer);
  const profile = Object.freeze({
    historyEntry: state.entry,
    readProfile: "endive-schedule-first-44-v1",
    coversObservation: () => true,
  });
  admissionControls.observation.splice(
    0,
    admissionControls.observation.length,
    profile,
  );
  return { ...state, reads, profile };
}
