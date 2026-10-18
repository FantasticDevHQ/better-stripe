import { z } from "zod";
import { STRIPE_API_VERSION } from "../constants.js";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "../apiVersion.js";
import {
  defineUsagePlan,
  parseUsageQuantity,
  type UsagePlan,
} from "./contracts.js";

export const scopeSchema = z.strictObject({
  stripeAccountId: z.string().regex(/^acct_[a-zA-Z0-9]+$/),
  customerAccount: z.string().regex(/^acct_[a-zA-Z0-9]+$/),
  meterId: z.string().regex(/^mtr_[a-zA-Z0-9_]+$/),
  livemode: z.boolean(),
});
const recordSchema = z.strictObject({
  scope: scopeSchema,
  binding: z.strictObject({
    stripeCustomerId: z.string().regex(/^cus_[a-zA-Z0-9]+$/),
    stripePriceId: z.string().regex(/^price_[a-zA-Z0-9]+$/),
    eventName: z.string().min(1).max(100),
    apiVersion: z
      .enum([STRIPE_API_VERSION, STRIPE_CUSTOMER_PREVIEW_API_VERSION])
      .default(STRIPE_API_VERSION),
    plan: z.unknown(),
  }),
  sourceEventId: z.string().min(1).max(200),
  quantity: z.unknown(),
  occurredAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** The exact Stripe realm, Accounts v2 payer, meter and test/live scope. */
export type UsageScope = z.infer<typeof scopeSchema>;
export type PreparedUsageRecord = Omit<
  z.infer<typeof recordSchema>,
  "quantity" | "binding"
> & {
  schemaVersion: 1;
  identity: string;
  quantity: string;
  scaledQuantity: string;
  binding: Omit<z.infer<typeof recordSchema>["binding"], "plan"> & {
    plan: UsagePlan;
  };
};
export type UsageDeliveryState =
  "queued" | "sending" | "provider_accepted" | "rejected" | "unknown" | "held";

/**
 * Validate and snapshot a record before acceptance. This pure helper does not
 * authorize an actor, verify provider ownership, persist or deliver anything.
 * Occurrence time is Unix seconds; native provider windows are enforced by the
 * acceptance/delivery implementation, not by changing historical event time.
 */
export function prepareUsageRecord(input: unknown): PreparedUsageRecord {
  const record = recordSchema.parse(input);
  const plan = defineUsagePlan(record.binding.plan);
  const quantity = parseUsageQuantity(record.quantity, plan.unit.precision);
  const scope = record.scope;
  return {
    ...record,
    schemaVersion: 1,
    quantity: quantity.quantity,
    scaledQuantity: quantity.scaledQuantity,
    binding: { ...record.binding, plan },
    // A plan/version/quantity change must conflict with the original source
    // event, so these are deliberately outside the deduplication identity.
    identity: JSON.stringify([
      scope.livemode,
      scope.stripeAccountId,
      scope.customerAccount,
      scope.meterId,
      record.sourceEventId,
    ]),
  };
}

const preparedRecordSchema = recordSchema.extend({
  schemaVersion: z.literal(1),
  identity: z.string(),
  quantity: z.string(),
  scaledQuantity: z.string(),
});

/** Internal facade decoder: preparation is validation, never host authorization. */
export function validateUsageRecordInput(input: unknown): PreparedUsageRecord {
  const raw = recordSchema.safeParse(input);
  if (raw.success) return prepareUsageRecord(raw.data);
  // Validate the complete strict shape before selecting raw fields. Partial or
  // unknown prepared fields cannot silently become a valid raw event.
  const { schemaVersion, identity, scaledQuantity, ...record } =
    preparedRecordSchema.parse(input);
  const canonical = prepareUsageRecord(record);
  if (
    schemaVersion !== canonical.schemaVersion ||
    identity !== canonical.identity ||
    scaledQuantity !== canonical.scaledQuantity ||
    record.quantity !== canonical.quantity
  )
    throw new Error("Inconsistent prepared usage record");
  return canonical;
}
