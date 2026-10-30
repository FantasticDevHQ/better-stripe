import { freeze } from "../material/nodeKernel.js";
import assert from "node:assert/strict";
import { configurationInput } from "../acquisition/test-fixtures/fixture.mjs";
import {
  captureRetainedInput,
  type Bundle,
  type RetainedInput,
} from "../material/capture.js";
import type {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";
import type { validateOwnedReadMaterial } from "../material/readMaterial.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { data, list } from "./attachScenarioBarriers.js";
export const clone = structuredClone;
export function declaredInputs(name: string) {
  // All raw transforms precede constructors. Whole configurationInput source parity is recorded outside W.
  const seed = data(configurationInput()),
    preparation = data(clone(seed.preparation)),
    subscription = data(preparation.subscription);
  const couponReads: Record<string, unknown>[] = [],
    ids = new Set<unknown>();
  for (const source of [subscription, list(data(subscription.items).data)[0]])
    for (const discount of list(source.discounts)) {
      const ref = data(discount.source),
        coupon = data(ref.coupon);
      coupon.times_redeemed = 7;
      coupon.metadata = { declared: "SYNTHETIC_RETAINED_315", opaque: "keep" };
      coupon.future_native = { unknown: [null, 1.25, "ordinary"] };
      if (!ids.has(coupon.id)) {
        ids.add(coupon.id);
        couponReads.push({
          couponId: coupon.id,
          wireCoupon: clone(coupon),
          association: { resource: "coupon", ordinal: 4 + couponReads.length },
        });
      }
      ref.coupon = coupon.id;
    }
  subscription.opaque = { preserved: ["Sub", null] };
  data(preparation.targetPrice).opaque = { preserved: "Price" };
  data(preparation.billingCustomer).opaque = { preserved: "Customer" };
  const joins = [
    subscription.discounts,
    list(data(subscription.items).data)[0].discounts,
  ].map((value) =>
    list(value).map((discount, index) => {
      const ref = data(discount.source).coupon,
        couponReadIndex = couponReads.findIndex((row) => row.couponId === ref);
      assert(couponReadIndex >= 0);
      return {
        index,
        discountId: discount.id,
        originalCouponReference: clone(ref),
        couponReadIndex,
        joinedDiscount: {
          ...clone(discount),
          source: {
            ...clone(data(discount.source)),
            coupon: clone(couponReads[couponReadIndex].wireCoupon),
          },
        },
      };
    }),
  );
  const expected = data(preparation.expected);
  assert(typeof expected.periodStart === "number");
  const original = captureRetainedInput({
    attachRequest: {
      preparation,
      apiVersion: "2026-09-30.endive",
      attachKey: "attach:retained315",
      firstDispatchedAt: expected.periodStart + 1,
    },
    originalBundle: {
      wireSubscription: clone(subscription),
      wireTargetPrice: clone(preparation.targetPrice),
      wireBillingCustomer: clone(preparation.billingCustomer),
      couponReads,
      derivedCouponJoins: { subscription: joins[0], item: joins[1] },
    },
  });
  const current = clone(original.originalBundle);
  current.wireSubscription.schedule =
    name === "G02-expanded" || name === "G14-output"
      ? {
          id: "sub_sched_observed_recovery",
          object: "subscription_schedule",
          deleted: false,
          subscription: expected.subscriptionId,
          customer: original.originalBundle.wireBillingCustomer.id,
          customer_account: expected.customerAccountId,
          livemode: false,
          ...(name === "G14-output" ? { opaque: "o".repeat(120000) } : {}),
        }
      : "sub_sched_observed_recovery";
  const coverageCurrent = clone(current);
  if (name === "G06-current") {
    const item = data(current.wireSubscription.items.data[0]);
    assert(typeof item.quantity === "number");
    item.quantity++;
  }
  const post = clone(data(data(seed.attachReceipt).providerSnapshot));
  post.created = original.attachRequest.firstDispatchedAt;
  const aPost = clone(post),
    bPost = clone(post);
  if (name === "G09-q") aPost.opaque = "x".repeat(500001);
  if (name === "G12-wrong-identity") bPost.subscription = "sub_OTHER";
  if (name === "G14-output") bPost.opaque = "p".repeat(400000);
  return freeze({ original, current, coverageCurrent, post, aPost, bPost });
}
type Prepared = Awaited<ReturnType<typeof prepareRenewalPriceReplacementV2>>;
type Request = Awaited<ReturnType<typeof prepareRenewalScheduleAttachmentV2>>;
type Reads = ReturnType<typeof validateOwnedReadMaterial>;
export function declaredEntries(
  original: RetainedInput,
  prepared: Prepared,
  request: Request,
  reads: Reads,
  coverageCurrent: Bundle,
  retainedResult: true | 1 = true,
) {
  const expectedMaterial = (
    b: Bundle,
    intent: "initial" | "replay_unknown",
    fresh: boolean,
  ) => {
    const item = data(b.wireSubscription.items.data[0]);
    return {
      classificationRevision: "renewal-material-v2",
      protocolRevision: "renewal-stage-protocol-v1",
      stage: "attach",
      intent,
      scope: request.scope,
      apiVersion: request.apiVersion,
      profile: reads.profile,
      quantity: prepared.quantity,
      currentPrice: item.price,
      targetPrice: b.wireTargetPrice,
      source: b.wireSubscription,
      nativeItem: item,
      billingCustomer: b.wireBillingCustomer,
      subscriptionDiscounts: reads.discounts,
      itemDiscounts: reads.itemDiscounts,
      settings: reads.originalSettings,
      originalPrepared: prepared,
      completeRequest: request,
      stageEvidence: {
        actualFreshSubscription: b.wireSubscription,
        ...(intent === "replay_unknown"
          ? {
              historicalOriginalSubscription:
                original.originalBundle.wireSubscription,
            }
          : {}),
      },
      rawSources: fresh
        ? {
            attachRequest: original.attachRequest,
            intent,
            freshSubscription: b.wireSubscription,
            targetPrice: b.wireTargetPrice,
            billingCustomer: b.wireBillingCustomer,
            observedAt: original.attachRequest.firstDispatchedAt,
          }
        : { attachRequest: original.attachRequest, intent },
      freshness: fresh ? "fresh" : "retained",
    };
  };
  const retained = expectedMaterial(original.originalBundle, "initial", false),
    stats = {
      coversReplay: 0,
      retainedCalls: 0,
      retainedMatches: 0,
      lastRetainedResult: null as unknown,
    };
  const entry = Object.freeze({
    coversRetained(value: unknown, bundle: unknown) {
      stats.retainedCalls++;
      const matches =
        Object.keys(data(value)).length === 21 &&
        equal(value, retained) &&
        equal(bundle, original.originalBundle);
      if (matches) stats.retainedMatches++;
      const result = matches ? retainedResult : false;
      stats.lastRetainedResult = result;
      return result;
    },
    coversFresh(value: unknown, before: unknown, current: unknown) {
      return (
        equal(
          value,
          expectedMaterial(original.originalBundle, "initial", true),
        ) &&
        equal(before, original.originalBundle) &&
        equal(current, original.originalBundle)
      );
    },
  });
  const relation = Object.freeze({
    originalEntry: entry,
    coversReplay(value: unknown, before: unknown, current: unknown) {
      stats.coversReplay++;
      return (
        Object.keys(data(value)).length === 21 &&
        equal(
          value,
          expectedMaterial(coverageCurrent, "replay_unknown", true),
        ) &&
        equal(before, original.originalBundle) &&
        equal(current, coverageCurrent)
      );
    },
  });
  return { entry, relation, retained, stats };
}
