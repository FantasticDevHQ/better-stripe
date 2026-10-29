import {
  object,
  array,
  need,
  clone,
  get,
  equal,
  productId,
  planMatchesPrice,
  type O,
} from "./common.js";
import type { settingsStage } from "./settings-normalization.js";
export function phasesStage(state: ReturnType<typeof settingsStage>) {
  const { context, ref, coupon, currentRedemptions, settings } = state;
  // BEGIN original 670-758
  const phaseDiscounts = (v: unknown) =>
    array(v).map((row) => {
      const d = clone(object(row));
      need(
        d.promotion_code === null,
        "promotion_code_not_supported",
        "unknown",
      );
      const id =
        typeof d.discount === "string"
          ? d.discount
          : String(object(d.discount).id);
      const known = currentRedemptions.get(id);
      need(known, "phase_redemption_not_correlated", "unknown");
      if (typeof d.discount !== "string") {
        const expanded = object(d.discount);
        need(
          expanded.object === "discount" && expanded.deleted !== true,
          "bad_expanded_discount",
        );
        if (
          !Object.keys(expanded).every((k) =>
            ["id", "object", "deleted"].includes(k),
          )
        ) {
          const joined = clone(expanded);
          const source = get(joined, "source");
          source.coupon = coupon(source.coupon);
          joined.source = source;
          need(equal(joined, known), "expanded_discount_read_drift");
        }
      }
      if (d.coupon !== null) {
        const cid =
          typeof d.coupon === "string" ? d.coupon : object(d.coupon).id;
        need(
          cid === get(get(known!, "source"), "coupon").id,
          "phase_coupon_identity_mismatch",
        );
        if (typeof d.coupon !== "string") coupon(d.coupon);
      }
      d.discount = id;
      d.coupon = get(get(known!, "source"), "coupon").id;
      return d;
    });
  const priceRef = (v: unknown, known: O, kind = "price") => {
    const id = ref(v, "price", kind);
    need(id === known.id, "phase_price_mismatch");
    if (typeof v !== "string") {
      const e = object(v);
      if (
        kind === "plan" &&
        !Object.keys(e).every((k) => ["id", "object", "deleted"].includes(k))
      ) {
        need(
          planMatchesPrice(e, known, context),
          "unproven_full_plan_price_mapping",
          "unknown",
        );
        return id;
      }
      if (e.product !== undefined)
        need(
          productId(e.product, context) === productId(known.product, context),
          "phase_product_mismatch",
        );
      if (e.currency !== undefined)
        need(e.currency === known.currency, "phase_price_currency_mismatch");
      if (
        kind === "price" &&
        !Object.keys(e).every((k) => ["id", "object", "deleted"].includes(k))
      )
        need(equal(e, known), "expanded_price_read_drift");
    }
    return id;
  };
  const normalizePhase = (v: O, known: O) => {
    const phase = settings(v);
    phase.discounts = phaseDiscounts(phase.discounts);
    const ps = array(phase.items);
    need(ps.length === 1, "ambiguous_phase_items", "unknown");
    const item = clone(object(ps[0]));
    item.price = priceRef(item.price, known);
    if (item.plan !== undefined) item.plan = priceRef(item.plan, known, "plan");
    item.discounts = phaseDiscounts(item.discounts);
    phase.items = [item];
    return phase;
  };
  // END original 670-758
  return { ...state, phaseDiscounts, priceRef, normalizePhase };
}
