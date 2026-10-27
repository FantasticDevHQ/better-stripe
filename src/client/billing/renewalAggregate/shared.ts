import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";

export const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const resourceId = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
export type ObjectData = Record<string, unknown>;
export class ProjectionError extends Error {
  constructor(
    readonly kind: "unsupported" | "conflict",
    reason: string,
  ) {
    super(reason);
  }
}
export function unsupported(reason: string): never {
  throw new ProjectionError("unsupported", reason);
}
export function conflict(reason: string): never {
  throw new ProjectionError("conflict", reason);
}
export const object = (value: unknown): ObjectData =>
  z.record(z.string(), z.unknown()).parse(value);
export const canonical = (value: unknown) =>
  JSON.stringify(renewalSnapshot(value));
export const binding = (namespace: string, value: unknown) =>
  `${namespace}:v1:${canonical(value)}`;
export const equal = (left: unknown, right: unknown) =>
  canonical(left) === canonical(right);

export type ReferenceContext = { livemode: boolean; customerAccountId: string };
function referenceFacts(reference: ObjectData, context?: ReferenceContext) {
  if (
    context &&
    ((reference.livemode !== undefined &&
      reference.livemode !== context.livemode) ||
      (reference.customer_account !== undefined &&
        reference.customer_account !== context.customerAccountId))
  )
    unsupported("expanded_reference_scope_mismatch");
}
export function referenceId(
  value: unknown,
  prefix: string,
  kind: string,
  context?: ReferenceContext,
): string {
  if (typeof value === "string") return resourceId(prefix).parse(value);
  const reference = object(value);
  if (reference.object !== kind || reference.deleted === true)
    unsupported(`invalid_${kind}_reference`);
  referenceFacts(reference, context);
  return resourceId(prefix).parse(reference.id);
}
export function productId(value: unknown, context: ReferenceContext): string {
  const id = z.string().min(1).max(255).regex(/\S/);
  if (typeof value === "string") return id.parse(value);
  const reference = object(value);
  if (reference.object !== "product" || reference.deleted === true)
    unsupported("invalid_product_reference");
  referenceFacts(reference, context);
  return id.parse(reference.id);
}
export type Failure =
  | { status: "unsupported" | "conflict"; reason: string }
  | { status: "attached_unconfigured"; scheduleId: string; reason: string };
export function failure(error: unknown, scheduleId?: string): Failure {
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

export function supportedVersion(version: string) {
  if (version !== "2026-09-30.endive")
    unsupported("unqualified_api_version_profile");
  return version;
}
