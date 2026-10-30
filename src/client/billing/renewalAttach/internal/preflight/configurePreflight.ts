import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import {
  COMPILED_PREFLIGHT_ENTRIES as ENTRIES,
  loadOwnedConfigureOperation,
  ORIGINAL_ORIGIN_ASSOCIATION,
} from "../operations/sourceOperations.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
import { closed, need } from "../operations/types.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { capturePreflightRecord } from "./record.js";
import { verifyPreflightRecord, verifyCurrentPreflight } from "./relations.js";
import { releasePreflight } from "./output.js";
import { bindConfigureReadAcquisitionFromSource } from "../acquisition/ownedAcquisition.js";
import { createConfigureOwnedReadTransport } from "../operations/configureReadTransport.js";
import type { Bundle } from "../material/capture.js";
import type { PreflightRecord } from "./grammar.js";

const stop = (): never => {
  throw Error("CONFIGURE_PREFLIGHT_STOP");
};
let capturedOnce = false;
function ownMethod(
  object: unknown,
  name: string,
): (...args: unknown[]) => unknown {
  need(object !== null && typeof object === "object" && !types.isProxy(object));
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  need(
    descriptor &&
      descriptor.enumerable &&
      "value" in descriptor &&
      typeof descriptor.value === "function" &&
      !types.isProxy(descriptor.value),
  );
  return descriptor.value as (...args: unknown[]) => unknown;
}
function expectedPlan(record: PreflightRecord) {
  const expected = record.configuration.preparation.expected;
  const customer = record.originalBundle.wireBillingCustomer.id;
  need(typeof customer === "string");
  const query =
    "?" +
    new URLSearchParams(
      ["discounts", "items.data.discounts", "items.data.price"].map(
        (value, index) => ["expand[" + index + "]", value],
      ),
    );
  const resources = [
    {
      resource: "subscription",
      path:
        "/v1/subscriptions/" +
        encodeURIComponent(expected.subscriptionId) +
        query,
    },
    {
      resource: "price",
      path: "/v1/prices/" + encodeURIComponent(expected.targetPriceId),
    },
    {
      resource: "customer",
      path: "/v1/customers/" + encodeURIComponent(customer),
    },
    ...record.originalBundle.couponReads.map((row) => {
      need(typeof row.couponId === "string");
      return {
        resource: "coupon",
        path: "/v1/coupons/" + encodeURIComponent(row.couponId),
      };
    }),
    {
      resource: "schedule",
      path:
        "/v1/subscription_schedules/" +
        encodeURIComponent(record.attachReceipt.scheduleId),
    },
  ];
  return Object.freeze(
    resources.map((row, index) =>
      Object.freeze({
        ...row,
        ordinal: index + 1,
        method: "GET",
        body: undefined,
        options: Object.freeze({
          apiVersion: "2026-09-30.endive",
          maxNetworkRetries: 0,
        }),
      }),
    ),
  );
}
/** Complete raw equality to the verified typed baseline, not a schema cast or Source proof. */
function matchesCurrentBundle(
  value: unknown,
  record: PreflightRecord,
): value is Bundle {
  return equal(value, {
    ...record.originalBundle,
    wireSubscription: record.configuration.freshSubscription,
  });
}

/** Internal readonly consistency invocation; detached output grants no write authority. */
export function captureOwnedConfigurePreflightV2() {
  if (arguments.length !== 0) stop();
  need(!types.isProxy(ENTRIES) && Array.isArray(ENTRIES));
  if (ENTRIES.length === 0) throw Error("CONFIGURE_PREFLIGHT_SOURCE_UNBOUND");
  if (capturedOnce) stop();
  capturedOnce = true;
  OWNER.check();
  const live = loadOwnedConfigureOperation();
  OWNER.check();
  const op = closed(live, [
    "owner",
    "originAssociation",
    "originalEntry",
    "preflightEntry",
    "actualAcknowledgement",
    "record",
    "readTransport",
  ]);
  need(
    op.owner === OWNER &&
      op.originAssociation !== null &&
      typeof op.originAssociation === "object" &&
      !types.isProxy(op.originAssociation) &&
      op.originAssociation === ORIGINAL_ORIGIN_ASSOCIATION &&
      ENTRIES.includes(op.preflightEntry),
  );
  const coverage = closed(op.preflightEntry, [
    "originalEntry",
    "coversPreflight",
  ]);
  need(
    op.originalEntry !== null &&
      typeof op.originalEntry === "object" &&
      !types.isProxy(op.originalEntry) &&
      coverage.originalEntry === op.originalEntry,
  );
  const covers = ownMethod(op.preflightEntry, "coversPreflight");
  const rawRecord = closed(op.record, [
    "configuration",
    "request",
    "attachReceipt",
    "originalBundle",
  ]);
  need(rawRecord.attachReceipt === op.actualAcknowledgement);
  const readMethod = ownMethod(op.readTransport, "rawRequest"),
    retained = capturePreflightRecord(op.record);
  OWNER.check();
  let consumed = false;
  return Object.freeze({
    async invoke() {
      if (arguments.length !== 0 || consumed) stop();
      consumed = true;
      OWNER.check();
      let original: Awaited<ReturnType<typeof projectRenewalConfigurationV2>>;
      try {
        original = await projectRenewalConfigurationV2(retained.configuration);
      } catch (error) {
        OWNER.check();
        throw error;
      }
      OWNER.check();
      if (original.status !== "projected_configure_request") return original;
      let ack: Awaited<
        ReturnType<typeof constructRenewalScheduleAttachmentReceiptV2>
      >;
      try {
        ack = await constructRenewalScheduleAttachmentReceiptV2(
          retained.configuration.attachReceipt,
        );
      } catch (error) {
        OWNER.check();
        throw error;
      }
      OWNER.check();
      const record = verifyPreflightRecord(retained, original, ack);
      OWNER.check();
      const pair = createConfigureOwnedReadTransport();
      OWNER.check();
      need(
        pair.capability.assertSourceOperationBinding(
          live,
          expectedPlan(record),
          op.readTransport,
          readMethod,
        ),
      );
      OWNER.check();
      need(pair.capability.reserveAcquisition());
      OWNER.check();
      const reader = bindConfigureReadAcquisitionFromSource(
        OWNER,
        pair.transport.readTransport,
        Object.freeze({
          expected: record.configuration.preparation.expected,
          scheduleId: ack.scheduleId,
        }),
      );
      OWNER.check();
      let acquired: Awaited<ReturnType<typeof reader.acquire>>;
      try {
        acquired = await reader.acquire();
      } catch (error) {
        OWNER.check();
        throw error;
      }
      OWNER.check();
      need(acquired.ok);
      need(matchesCurrentBundle(acquired.bundle, record));
      const evidence = Object.freeze({
        bundle: acquired.bundle,
        schedule: acquired.schedule,
        observedAt: acquired.observedAt,
      });
      verifyCurrentPreflight(record, evidence);
      OWNER.check();
      const configuration = {
        ...record.configuration,
        freshSubscription: evidence.bundle.wireSubscription,
        targetPrice: evidence.bundle.wireTargetPrice,
        ...(Object.prototype.hasOwnProperty.call(
          record.configuration,
          "billingCustomer",
        )
          ? { billingCustomer: evidence.bundle.wireBillingCustomer }
          : {}),
        schedule: evidence.schedule,
        observedAt: evidence.observedAt,
      };
      OWNER.check();
      let fresh: Awaited<ReturnType<typeof projectRenewalConfigurationV2>>;
      try {
        fresh = await projectRenewalConfigurationV2(configuration);
      } catch (error) {
        OWNER.check();
        throw error;
      }
      OWNER.check();
      if (fresh.status !== "projected_configure_request") return fresh;
      need(equal(fresh, original) && equal(fresh, record.request));
      need(
        Reflect.apply(covers, op.preflightEntry, [record, evidence, fresh]) ===
          true,
      );
      OWNER.check();
      const output = releasePreflight(record, evidence, fresh, original, ack);
      OWNER.check();
      return output;
    },
  });
}
