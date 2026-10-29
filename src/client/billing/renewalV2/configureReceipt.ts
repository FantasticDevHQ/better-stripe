import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import type { ObjectData } from "../renewalAggregate/shared.js";
import { validateConfigurationFields } from "./configureInput.js";

const stop = () => {
  throw Error("Invalid renewal configuration receipt input.");
};
function ownData(raw: unknown, required: string[], optional: string[] = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return stop();
  const keys = Reflect.ownKeys(raw);
  if (
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    ) ||
    required.some((k) => !keys.includes(k))
  )
    return stop();
  const fields: ObjectData = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !d.enumerable || !("value" in d)) return stop();
    fields[key as string] = d.value;
  }
  return fields;
}
function bareBody(raw: unknown) {
  if (
    raw !== null &&
    typeof raw === "object" &&
    Object.prototype.hasOwnProperty.call(raw, "lastResponse")
  )
    stop();
}
function closed(raw: unknown) {
  const root = ownData(raw, [
    "configuration",
    "actualDispatch",
    "providerSnapshot",
    "transport",
  ]);
  validateConfigurationFields(root.configuration);
  ownData(root.actualDispatch, [
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
  ]);
  ownData(root.transport, ["status"], ["requestId"]);
  bareBody(root.providerSnapshot);
  return root;
}
const input = z
  .object({
    configuration: z.unknown(),
    actualDispatch: z
      .object({
        scope: z.literal("platform"),
        apiVersion: z.string(),
        method: z.literal("POST"),
        path: z.string(),
        payload: z.unknown(),
        key: z.string(),
        firstDispatchedAt: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    // Validate, but never reconstruct, the complete owned JSON body.
    providerSnapshot: z.custom<ObjectData>(
      (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    ),
    transport: z
      .object({
        status: z.number().int().min(200).max(299),
        requestId: z.string().min(1).max(255).optional(),
      })
      .strict(),
  })
  .strict();
export function captureConfigurationReceipt(raw: unknown) {
  if (raw === null || typeof raw !== "object") stop();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) stop();
  const original = closed(raw);
  const captured = renewalSnapshot(original);
  closed(captured);
  // Catch metadata introduced by reflection during capture, including hidden data.
  bareBody(original.providerSnapshot);
  return input.parse(captured);
}
