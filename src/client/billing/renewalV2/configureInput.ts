import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { timestamp, type ObjectData } from "../renewalAggregate/shared.js";
import {
  captureAttachmentReceipt,
  validateAttachmentReceiptFields,
} from "./receipt.js";

function ownData(raw: unknown, required: string[], optional: string[] = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Invalid raw renewal configuration.");
  const keys = Reflect.ownKeys(raw);
  if (
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    ) ||
    required.some((k) => !keys.includes(k))
  )
    throw Error("Invalid raw renewal configuration fields.");
  const fields: ObjectData = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !d.enumerable || !("value" in d))
      throw Error("Renewal configuration requires own JSON data.");
    fields[key as string] = d.value;
  }
  return fields;
}
export function validateConfigurationFields(raw: unknown) {
  const root = ownData(
    raw,
    [
      "preparation",
      "attachReceipt",
      "freshSubscription",
      "targetPrice",
      "schedule",
      "apiVersion",
      "observedAt",
      "firstDispatchedAt",
      "configureKey",
    ],
    ["billingCustomer"],
  );
  ownData(
    root.preparation,
    ["subscription", "targetPrice", "expected", "key"],
    ["billingCustomer"],
  );
  validateAttachmentReceiptFields(root.attachReceipt);
}
const preparation = z
  .object({
    subscription: z.unknown(),
    targetPrice: z.unknown(),
    expected: z.unknown(),
    key: z.string(),
    billingCustomer: z.unknown().optional(),
  })
  .strict();
const input = z
  .object({
    preparation,
    attachReceipt: z.unknown(),
    freshSubscription: z.unknown(),
    targetPrice: z.unknown(),
    billingCustomer: z.unknown().optional(),
    schedule: z.unknown(),
    apiVersion: z.string(),
    observedAt: timestamp,
    firstDispatchedAt: timestamp,
    configureKey: z.string(),
  })
  .strict();
export function captureConfiguration(raw: unknown) {
  validateConfigurationFields(raw);
  const captured = renewalSnapshot(raw);
  validateConfigurationFields(captured);
  const args = input.parse(captured);
  return {
    ...args,
    attachReceipt: captureAttachmentReceipt(args.attachReceipt),
  };
}
