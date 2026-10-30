import { OWNER } from "../originalOwner.js";
import { closed, need, freeze, materialize } from "../material/nodeKernel.js";
import { equal, referenceId } from "../../../renewalAggregate/shared.js";
import type { Bundle } from "../material/capture.js";
import type {
  CurrentEvidence,
  PreflightRecord,
  Configuration,
  Data,
} from "./grammar.js";
import type { CapturedPreflightRecord } from "./record.js";
import type {
  ProjectedRenewalConfigurationV2,
  RenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
const couponID = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 255 &&
  /\S/.test(id) &&
  id !== "." &&
  id !== "..";
function rebuild(b: Bundle) {
  const subscription = b.wireSubscription;
  need(
    subscription &&
      subscription.items &&
      Array.isArray(subscription.items.data) &&
      subscription.items.data.length === 1,
  );
  const lists = [subscription.discounts, subscription.items.data[0].discounts];
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
        const c = row.wireCoupon as Record<string, unknown>;
        need(c && c.id === id && c.object === "coupon" && c.deleted !== true);
        ids.set(id, i);
      }
      const couponReadIndex = ids.get(id)!,
        coupon = b.couponReads[couponReadIndex].wireCoupon;
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
    subscription: joined[0].map((x) => x.joinedDiscount),
    item: joined[1].map((x) => x.joinedDiscount),
  };
}
export function expectedSlots(
  request: ProjectedRenewalConfigurationV2,
  receipt: RenewalScheduleAttachmentReceiptV2,
  output: boolean,
): Record<string, string> {
  const record = {
    "/request/logicalBinding": request.logicalBinding,
    "/request/attachReceiptBinding": request.attachReceiptBinding,
    "/request/baselineBinding": request.baselineBinding,
    "/request/defaultSettingsBinding": request.defaultSettingsBinding,
    "/request/requestIdentity/binding": request.requestIdentity.binding,
    "/attachReceipt/logicalBinding": receipt.logicalBinding,
    "/attachReceipt/request/logicalBinding": receipt.request.logicalBinding,
    "/attachReceipt/request/requestIdentity/binding":
      receipt.request.requestIdentity.binding,
    "/attachReceipt/binding": receipt.binding,
  };
  if (!output) return record;
  return Object.fromEntries([
    ...Object.entries(record).map(([k, v]) => ["/originalRecord" + k, v]),
    ...Object.entries(record).filter(([k]) => k.startsWith("/request/")),
  ]);
}
export function verifyPreflightRecord(
  captured: CapturedPreflightRecord,
  originalC6: ProjectedRenewalConfigurationV2,
  ackC3: RenewalScheduleAttachmentReceiptV2,
): PreflightRecord {
  OWNER.check();
  const expected = expectedSlots(originalC6, ackC3, false);
  for (const [path, value] of Object.entries(expected))
    need(captured.captured.slots.get(path) === value);
  const record = materialize(captured.captured.node) as PreflightRecord;
  need(equal(record.request, originalC6) && equal(record.attachReceipt, ackC3));
  verifyOriginalRaw(record, ackC3);
  OWNER.check();
  return freeze(record);
}
function association(value: unknown, id: string, configuration: Configuration) {
  const e = configuration.preparation.expected,
    ctx = { customerAccountId: e.customerAccountId, livemode: e.livemode };
  need(referenceId(value, "sub_sched", "subscription_schedule", ctx) === id);
  if (value !== null && typeof value === "object")
    need(
      !Object.prototype.hasOwnProperty.call(value, "deleted") ||
        (value as Record<string, unknown>).deleted === false,
    );
}
function verifyOriginalRaw(
  record: PreflightRecord,
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
    wireTargetPrice: c.targetPrice as Data,
    wireBillingCustomer: c.billingCustomer as Data,
    couponReads: o.couponReads,
    derivedCouponJoins: o.derivedCouponJoins,
  };
  rebuild(preconfigure);
}
export function verifyCurrentPreflight(
  record: PreflightRecord,
  evidence: CurrentEvidence,
) {
  OWNER.check();
  closed(evidence, ["bundle", "schedule", "observedAt"]);
  need(Number.isSafeInteger(evidence.observedAt) && evidence.observedAt >= 0);
  const c = record.configuration,
    o = record.originalBundle,
    b = evidence.bundle;
  closed(b, [
    "wireSubscription",
    "wireTargetPrice",
    "wireBillingCustomer",
    "couponReads",
    "derivedCouponJoins",
  ]);
  need(
    equal(evidence.schedule, c.schedule) &&
      equal(evidence.schedule, record.attachReceipt.providerSnapshot),
  );
  for (const [name, wire] of [
    ["freshSubscription", "wireSubscription"],
    ["targetPrice", "wireTargetPrice"],
    ["billingCustomer", "wireBillingCustomer"],
  ] as const)
    need(equal(c[name], b[wire]));
  rebuild(b);
  need(
    equal(b.couponReads, o.couponReads) &&
      equal(b.derivedCouponJoins, o.derivedCouponJoins),
  );
  association(b.wireSubscription.schedule, record.attachReceipt.scheduleId, c);
  OWNER.check();
}
