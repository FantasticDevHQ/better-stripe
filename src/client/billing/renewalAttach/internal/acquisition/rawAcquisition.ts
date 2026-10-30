import { OWNER } from "../originalOwner.js";
import { createSourceStockRawDelegate } from "../stockRawDelegate.js";
import { freeze } from "../material/nodeKernel.js";
import { z } from "zod";
import {
  renewalExpected,
  renewalSubscription,
  renewalPrice,
  renewalBillingCustomer,
} from "../../../renewalReplacementSchema.js";
import {
  resourceId,
  productId,
  referenceId,
} from "../../../renewalAggregate/shared.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { createReadLifetime } from "./readLifetime.js";
import { bindWireSource, rejectProxyJSON } from "./rawWireSource.js";
import { acquireCouponJoins } from "./rawCouponJoins.js";
const need: (x: unknown) => asserts x = (x) => {
  if (!x) throw Error("RAW_ACQUISITION_STOP");
};
const STOP = Object.freeze({
  ok: false,
  complete: false,
  code: "RAW_ACQUISITION_STOP",
});

export type RawAcquisitionResult =
  | typeof STOP
  | Readonly<{
      ok: true;
      dataOnly: true;
      bundle: {
        wireSubscription: Record<string, unknown>;
        wireTargetPrice: Record<string, unknown>;
        wireBillingCustomer: Record<string, unknown>;
      } & Awaited<ReturnType<typeof acquireCouponJoins>>;
      observedAt: number;
      sourceFulfillmentEstablished: false;
      clockProvenanceEstablished: false;
      operatorReady: false;
    }>;
const observed = z.union([
  z.null(),
  resourceId("sub_sched"),
  z
    .object({
      id: resourceId("sub_sched"),
      object: z.literal("subscription_schedule"),
      deleted: z.literal(false).optional(),
    })
    .passthrough(),
]);
const subscriptionView = renewalSubscription.extend({ schedule: observed });
// No public/operational entry binds this primitive. Only the separate TEST port binds fakes.
export function createSourceRawAcquisition(): Readonly<{
  acquire(rawExpected: unknown): Promise<RawAcquisitionResult>;
}> {
  if (arguments.length !== 0) throw Error("RAW_ACQUISITION_STOP");
  const sourceOwner = OWNER;
  sourceOwner.check();
  const sourceTransport = createSourceStockRawDelegate();
  sourceOwner.check();
  const lifetime = createReadLifetime(sourceOwner),
    read = bindWireSource(sourceTransport, lifetime);
  return Object.freeze({
    async acquire(rawExpected: unknown) {
      try {
        if (!lifetime.begin()) return STOP;
      } catch {
        return STOP;
      }
      try {
        rejectProxyJSON(rawExpected);
        const expected = renewalExpected.parse(
            requiredJSONSnapshot(rawExpected),
          ),
          context = {
            customerAccountId: expected.customerAccountId,
            livemode: expected.livemode,
          };
        const wireSubscription = await read(
          "subscription",
          expected.subscriptionId,
        );
        lifetime.check();
        const subscription = subscriptionView.parse(wireSubscription),
          item = subscription.items.data[0];
        need(
          subscription.id === expected.subscriptionId &&
            subscription.customer_account === expected.customerAccountId &&
            subscription.livemode === expected.livemode &&
            item.id === expected.itemId &&
            item.subscription === expected.subscriptionId &&
            item.price.id === expected.currentPriceId &&
            item.price.livemode === expected.livemode &&
            productId(item.price.product, context) ===
              expected.currentProductId &&
            item.current_period_start === expected.periodStart &&
            item.current_period_end === expected.periodEnd,
        );
        const wireTargetPrice = await read("price", expected.targetPriceId);
        lifetime.check();
        const price = renewalPrice.parse(wireTargetPrice);
        need(
          price.id === expected.targetPriceId &&
            price.livemode === expected.livemode &&
            productId(price.product, context) === expected.targetProductId,
        );
        const customerID = referenceId(
            subscription.customer,
            "cus",
            "customer",
            context,
          ),
          wireBillingCustomer = await read("customer", customerID);
        lifetime.check();
        const customer = renewalBillingCustomer.parse(wireBillingCustomer);
        need(
          customer.id === customerID &&
            customer.customer_account === expected.customerAccountId &&
            customer.livemode === expected.livemode,
        );
        const joined = await acquireCouponJoins(
          wireSubscription,
          (wireSubscription as z.infer<typeof subscriptionView>).items.data[0],
          expected.livemode,
          read,
          lifetime,
        );
        lifetime.check();
        const sample = lifetime.check(),
          bundle = {
            wireSubscription,
            wireTargetPrice,
            wireBillingCustomer,
            ...joined,
          };
        const result = requiredJSONSnapshot({
          ok: true,
          dataOnly: true,
          bundle,
          observedAt: Math.floor(sample.wallMs / 1000),
          sourceFulfillmentEstablished: false,
          clockProvenanceEstablished: false,
          operatorReady: false,
        }) as RawAcquisitionResult;
        lifetime.finish();
        return freeze(result);
      } catch {
        try {
          lifetime.check();
        } catch {}
        lifetime.fail();
        return STOP;
      }
    },
  });
}
