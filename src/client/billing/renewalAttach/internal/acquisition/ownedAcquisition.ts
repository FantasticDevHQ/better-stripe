import { types } from "node:util";
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
import {
  bindWireSource,
  rejectProxyJSON,
  type RawReadTransport,
} from "./rawWireSource.js";
import { acquireCouponJoins } from "./rawCouponJoins.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { ownedAwaitForInitialLineage } from "../producer/ownedAwaitFactory.js";
import { operationForInitialLineage } from "../producer/operationFactory.js";
import { createInitialTransportForLineage } from "../operations/fixedTransport.js";
const need: (x: unknown) => asserts x = (x) => {
  if (!x) throw Error("RAW_ACQUISITION_STOP");
};
const STOP = Object.freeze({
  ok: false,
  complete: false,
  code: "RAW_ACQUISITION_STOP",
});

type RawSuccess = Readonly<{
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
export type RawAcquisitionResult = typeof STOP | RawSuccess;
export type RawConfigureAcquisitionResult =
  typeof STOP | (RawSuccess & Readonly<{ schedule: Record<string, unknown> }>);
type InitialReader = Readonly<{ acquire(): Promise<RawAcquisitionResult> }>;
const initialReaders = new WeakMap<object, Promise<InitialReader>>();

/** Fixed source, transport and expected material; no replacement inputs. */
export function acquisitionForInitialLineage(
  token: object,
): Promise<InitialReader> {
  if (arguments.length !== 1) throw Error("RAW_ACQUISITION_STOP");
  const owner = ownerForInitialLineage(token);
  owner.check();
  const owned = ownedAwaitForInitialLineage(token);
  let pending = initialReaders.get(token);
  if (!pending) {
    pending = owned(async () => {
      try {
        const frame = await operationForInitialLineage(token);
        const pair = await createInitialTransportForLineage(token);
        owner.check();
        const reader = createSelectedRawAcquisition(
          owner,
          captureTransport(pair.transport.readTransport),
        );
        return Object.freeze({
          acquire() {
            if (arguments.length !== 0) throw Error("RAW_ACQUISITION_STOP");
            return owned(() => reader.acquire(frame.expected));
          },
        });
      } catch (error) {
        owner.retire();
        throw error;
      }
    });
    initialReaders.set(token, pending);
  }
  const captured = pending;
  return owned(() => captured);
}
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
  return createSelectedRawAcquisition(sourceOwner, sourceTransport);
}

/** Internal mechanical binding. It returns unsigned read data, not an operation context. */
export function bindRawAcquisitionFromSource(
  sourceOwner: typeof OWNER,
  sourceTransport: RawReadTransport,
): Readonly<{ acquire(rawExpected: unknown): Promise<RawAcquisitionResult> }> {
  if (arguments.length !== 2 || sourceOwner !== OWNER)
    throw Error("RAW_ACQUISITION_STOP");
  sourceOwner.check();
  const capturedTransport = captureTransport(sourceTransport);
  sourceOwner.check();
  return createSelectedRawAcquisition(sourceOwner, capturedTransport);
}

/** Fixed readonly configure profile. Its output is unsigned DATA, never operation authority. */
export function bindConfigureReadAcquisitionFromSource(
  sourceOwner: typeof OWNER,
  sourceTransport: RawReadTransport,
  fixedScope: Readonly<{ expected: unknown; scheduleId: string }>,
): Readonly<{ acquire(): Promise<RawConfigureAcquisitionResult> }> {
  if (arguments.length !== 3 || sourceOwner !== OWNER)
    throw Error("RAW_ACQUISITION_STOP");
  sourceOwner.check();
  need(fixedScope !== null && typeof fixedScope === "object");
  need(!types.isProxy(fixedScope));
  const prototype = Object.getPrototypeOf(fixedScope);
  need(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(fixedScope);
  need(
    keys.length === 2 &&
      keys.includes("expected") &&
      keys.includes("scheduleId"),
  );
  const expectedDescriptor = Object.getOwnPropertyDescriptor(
      fixedScope,
      "expected",
    ),
    scheduleDescriptor = Object.getOwnPropertyDescriptor(
      fixedScope,
      "scheduleId",
    );
  need(
    expectedDescriptor &&
      expectedDescriptor.enumerable &&
      "value" in expectedDescriptor,
  );
  need(
    scheduleDescriptor &&
      scheduleDescriptor.enumerable &&
      "value" in scheduleDescriptor,
  );
  need(typeof scheduleDescriptor.value === "string");
  rejectProxyJSON(expectedDescriptor.value);
  const expected = freeze(requiredJSONSnapshot(expectedDescriptor.value)),
    scheduleId = resourceId("sub_sched").parse(scheduleDescriptor.value),
    capturedTransport = captureTransport(sourceTransport);
  sourceOwner.check();
  const reader = createSelectedRawAcquisition(
    sourceOwner,
    capturedTransport,
    scheduleId,
  );
  return Object.freeze({
    acquire() {
      return reader.acquire(expected);
    },
  });
}

function captureTransport(sourceTransport: RawReadTransport): RawReadTransport {
  need(sourceTransport !== null && typeof sourceTransport === "object");
  need(!types.isProxy(sourceTransport));
  const prototype = Object.getPrototypeOf(sourceTransport);
  need(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(sourceTransport);
  need(keys.length === 1 && keys[0] === "rawRequest");
  const descriptor = Object.getOwnPropertyDescriptor(
    sourceTransport,
    "rawRequest",
  );
  need(
    descriptor &&
      descriptor.enumerable &&
      "value" in descriptor &&
      typeof descriptor.value === "function",
  );
  const method = descriptor.value as RawReadTransport["rawRequest"];
  const capturedTransport: RawReadTransport = Object.freeze({
    rawRequest(...args: Parameters<RawReadTransport["rawRequest"]>) {
      return Reflect.apply(method, sourceTransport, args) as ReturnType<
        RawReadTransport["rawRequest"]
      >;
    },
  });
  return capturedTransport;
}

export function createSelectedRawAcquisition(
  sourceOwner: typeof OWNER,
  sourceTransport: RawReadTransport,
): Readonly<{ acquire(rawExpected: unknown): Promise<RawAcquisitionResult> }>;
export function createSelectedRawAcquisition(
  sourceOwner: typeof OWNER,
  sourceTransport: RawReadTransport,
  fixedScheduleId: string,
): Readonly<{
  acquire(rawExpected: unknown): Promise<RawConfigureAcquisitionResult>;
}>;
export function createSelectedRawAcquisition(
  sourceOwner: typeof OWNER,
  sourceTransport: RawReadTransport,
  fixedScheduleId: string | null = null,
): Readonly<{
  acquire(
    rawExpected: unknown,
  ): Promise<RawAcquisitionResult | RawConfigureAcquisitionResult>;
}> {
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
        let schedule: Record<string, unknown> | undefined;
        if (fixedScheduleId !== null) {
          need(
            referenceId(
              subscription.schedule,
              "sub_sched",
              "subscription_schedule",
              context,
            ) === fixedScheduleId,
          );
          schedule = await read("schedule", fixedScheduleId);
          lifetime.check();
          need(
            schedule.id === fixedScheduleId &&
              schedule.object === "subscription_schedule" &&
              schedule.deleted !== true,
          );
        }
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
          ...(fixedScheduleId === null ? {} : { schedule }),
          observedAt: Math.floor(sample.wallMs / 1000),
          sourceFulfillmentEstablished: false,
          clockProvenanceEstablished: false,
          operatorReady: false,
        }) as RawAcquisitionResult | RawConfigureAcquisitionResult;
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
