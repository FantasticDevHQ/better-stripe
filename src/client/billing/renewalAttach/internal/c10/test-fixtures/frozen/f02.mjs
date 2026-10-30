import { z } from "zod";
import { renewalSnapshot } from "./f10.mjs";
export const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const resourceId = (prefix) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
export class ProjectionError extends Error {
  kind;
  constructor(kind, reason) {
    super(reason);
    this.kind = kind;
  }
}
export function unsupported(reason) {
  throw new ProjectionError("unsupported", reason);
}
export function conflict(reason) {
  throw new ProjectionError("conflict", reason);
}
export const object = (value) => z.record(z.string(), z.unknown()).parse(value);
export const canonical = (value) => JSON.stringify(renewalSnapshot(value));
export const binding = (namespace, value) =>
  `${namespace}:v1:${canonical(value)}`;
export const equal = (left, right) => canonical(left) === canonical(right);
function referenceFacts(reference, context) {
  if (
    context &&
    ((reference.livemode !== undefined &&
      reference.livemode !== context.livemode) ||
      (reference.customer_account !== undefined &&
        reference.customer_account !== context.customerAccountId))
  )
    unsupported("expanded_reference_scope_mismatch");
}
export function referenceId(value, prefix, kind, context) {
  if (typeof value === "string") return resourceId(prefix).parse(value);
  const reference = object(value);
  if (reference.object !== kind || reference.deleted === true)
    unsupported(`invalid_${kind}_reference`);
  referenceFacts(reference, context);
  return resourceId(prefix).parse(reference.id);
}
export function productId(value, context) {
  const id = z.string().min(1).max(255).regex(/\S/);
  if (typeof value === "string") return id.parse(value);
  const reference = object(value);
  if (reference.object !== "product" || reference.deleted === true)
    unsupported("invalid_product_reference");
  referenceFacts(reference, context);
  return id.parse(reference.id);
}
export function failure(error, scheduleId) {
  const known = error instanceof ProjectionError;
  const kind = known ? error.kind : "unsupported";
  const reason = known ? error.message : "incomplete_or_unsupported_schema";
  if (kind === "unsupported" && scheduleId)
    return { status: "attached_unconfigured", scheduleId, reason };
  return { status: kind, reason };
}
export const readInput = z
  .object({
    prepared: z.unknown(),
    freshSubscription: z.unknown(),
    targetPrice: z.unknown(),
    billingCustomer: z.unknown().optional(),
    apiVersion: z.string(),
    observedAt: timestamp,
  })
  .strict();
export const configureInput = readInput
  .extend({
    attachReceipt: z.unknown(),
    schedule: z.unknown(),
    configureKey: z.string(),
    firstDispatchedAt: timestamp,
  })
  .strict();
export function supportedVersion(version) {
  if (version !== "2026-09-30.endive")
    unsupported("unqualified_api_version_profile");
  return version;
}
