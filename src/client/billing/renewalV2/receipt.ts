import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  referenceId,
  timestamp,
  type ObjectData,
} from "../renewalAggregate/shared.js";

const preparation = z
  .object({
    subscription: z.unknown(),
    targetPrice: z.unknown(),
    billingCustomer: z.unknown().optional(),
    expected: z.unknown(),
    key: z.string(),
  })
  .strict();
const attachRequest = z
  .object({
    preparation,
    apiVersion: z.string(),
    attachKey: z.string(),
    firstDispatchedAt: timestamp,
  })
  .strict();
const dispatch = z
  .object({
    scope: z.literal("platform"),
    apiVersion: z.string(),
    method: z.literal("POST"),
    path: z.literal("/v1/subscription_schedules"),
    payload: z.object({ from_subscription: z.string() }).strict(),
    key: z.string(),
    firstDispatchedAt: timestamp,
  })
  .strict();
const input = z
  .object({
    attachRequest,
    actualDispatch: dispatch,
    // The bounded JSON capture already owns this plain object. A record parser
    // can discard special own keys such as __proto__, changing the bound body.
    providerSnapshot: z.custom<ObjectData>(
      (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    ),
  })
  .strict();

function ownData(raw: unknown, required: string[], optional: string[] = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Invalid renewal receipt input.");
  const keys = Reflect.ownKeys(raw);
  if (
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    ) ||
    required.some((k) => !keys.includes(k))
  )
    throw Error("Invalid renewal receipt fields.");
  const result: ObjectData = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!d || !d.enumerable || !("value" in d))
      throw Error("Renewal receipt requires own JSON data.");
    result[key as string] = d.value;
  }
  return result;
}
export function validateAttachmentReceiptFields(raw: unknown) {
  const root = ownData(raw, [
    "attachRequest",
    "actualDispatch",
    "providerSnapshot",
  ]);
  const request = ownData(root.attachRequest, [
    "preparation",
    "apiVersion",
    "attachKey",
    "firstDispatchedAt",
  ]);
  ownData(
    request.preparation,
    ["subscription", "targetPrice", "expected", "key"],
    ["billingCustomer"],
  );
  const wire = ownData(root.actualDispatch, [
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
  ]);
  ownData(wire.payload, ["from_subscription"]);
}
export function captureAttachmentReceipt(raw: unknown) {
  validateAttachmentReceiptFields(raw);
  const captured = renewalSnapshot(raw);
  // Recheck the detached object: hostile reflection can mutate the live source.
  validateAttachmentReceiptFields(captured);
  return input.parse(captured);
}

/** Available identity facts only, never response provenance or financial proof. */
export function assertAttachmentIdentity(
  body: ObjectData,
  operation: {
    scheduleId: string;
    subscriptionId: string;
    billingCustomerId: string;
    customerAccountId: string;
    livemode: boolean;
  },
) {
  const need = (v: boolean) => {
    if (!v) throw Error("Unverified renewal attachment identity.");
  };
  const context = {
    customerAccountId: operation.customerAccountId,
    livemode: operation.livemode,
  };
  const check = (
    value: unknown,
    kind: "customer" | "subscription" | "subscription_schedule",
    depth: number,
  ): void => {
    need(depth <= 40);
    const prefix =
      kind === "customer"
        ? "cus"
        : kind === "subscription"
          ? "sub"
          : "sub_sched";
    const expected =
      kind === "customer"
        ? operation.billingCustomerId
        : kind === "subscription"
          ? operation.subscriptionId
          : operation.scheduleId;
    need(referenceId(value, prefix, kind, context) === expected);
    if (typeof value === "string") return;
    const expanded = value as ObjectData;
    need(expanded.deleted === undefined || expanded.deleted === false);
    const owns = (key: string) =>
      Object.prototype.hasOwnProperty.call(expanded, key);
    if (kind !== "customer" && owns("customer"))
      check(expanded.customer, "customer", depth + 1);
    if (kind === "subscription" && owns("schedule"))
      check(expanded.schedule, "subscription_schedule", depth + 1);
    if (kind === "subscription_schedule" && owns("subscription"))
      check(expanded.subscription, "subscription", depth + 1);
  };
  need(
    body.object === "subscription_schedule" &&
      body.id === operation.scheduleId &&
      (body.deleted === undefined || body.deleted === false) &&
      body.customer_account === operation.customerAccountId &&
      body.livemode === operation.livemode,
  );
  check(body.customer, "customer", 0);
  check(body.subscription, "subscription", 0);
}
