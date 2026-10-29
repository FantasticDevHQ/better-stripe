import {
  object,
  array,
  need,
  clone,
  get,
  planMatchesPrice,
  type O,
} from "./common.js";
import type { phasesStage } from "./phase-price-normalization.js";
export function normalize(state: ReturnType<typeof phasesStage>) {
  const {
    context,
    ref,
    actualItemDiscounts,
    actualSubDiscounts,
    originalItemDiscounts,
    originalSubDiscounts,
    settings,
  } = state;
  // BEGIN original 759-787
  const normalizeSchedule = (v: O) => {
    const s = clone(v);
    s.customer = ref(s.customer, "cus", "customer");
    s.subscription = ref(s.subscription, "sub", "subscription");
    s.default_settings = settings(get(s, "default_settings"));
    return s;
  };
  const normalizeSub = (v: O, stage: "original" | "target", knownPrice: O) => {
    const s = settings(v);
    s.customer = ref(s.customer, "cus", "customer");
    s.schedule = ref(s.schedule, "sub_sched", "subscription_schedule");
    const i = clone(object(array(get(s, "items").data)[0]));
    need(
      planMatchesPrice(i.plan, knownPrice, context),
      "unproven_native_plan_price_mapping",
      "unknown",
    );
    i.plan = knownPrice.id;
    i.discounts =
      stage === "target" ? actualItemDiscounts : originalItemDiscounts;
    s.discounts =
      stage === "target" ? actualSubDiscounts : originalSubDiscounts;
    get(s, "items").data = [i];
    return s;
  };
  // END original 759-787
  return { ...state, normalizeSchedule, normalizeSub };
}
