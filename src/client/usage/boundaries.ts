import type { PreparedUsageRecord, UsageScope } from "./records.js";
import { prepareUsageRecord } from "./records.js";
import { z } from "zod";
import { defineUsagePlan } from "./contracts.js";

export type UsagePeriod = { start: number; end: number };
export type UsagePageRequest = {
  period: UsagePeriod;
  limit: number;
  cursor: string | null;
};
export type UsageAvailability<T> =
  | { status: "available"; value: T; observedAt: number }
  | {
      status: "unavailable" | "unsupported";
      reason: string;
      retryable: boolean;
    };
export type UsageAuthorization<Context> = {
  /** Throw on denial. Resolve identity and tenant ownership in the host. */
  authorize(
    ctx: Context,
    request: {
      scope: UsageScope;
      operation: "record" | "read" | "reconcile" | "correct" | "configure";
    },
  ): Promise<void>;
  /** Throw when the server-verified activity is not billable. */
  authorizeActivity(ctx: Context, record: PreparedUsageRecord): Promise<void>;
};

/** Independent observations; none is inferred from another field. */
export type UsageObservations = {
  localAcceptedQuantity: string;
  providerAcceptedQuantity: string;
  aggregate: UsageAvailability<{ quantity: string; complete: boolean }>;
  estimate: UsageAvailability<{ amountDecimal: string; currency: string }>;
  invoice: UsageAvailability<{
    invoiceId: string;
    status: "draft" | "open" | "paid" | "void" | "uncollectible";
    amount: string;
    currency: string;
  }>;
};
export type UsageCorrectionRequest = {
  scope: UsageScope;
  sourceEventId: string;
  correctionId: string;
  reason: string;
  /** Cancellation preserves the original event. Replacement is a new event. */
  operation: "cancel";
};
export type UsageRetentionPolicy = {
  /** Financial evidence has no automatic deletion path. */
  financialEvidence: "retain";
  /** Execution payload cleanup must never erase event/payment/correction history. */
  executionJournalDays: number;
};
export type UsageTransitionRequest = {
  scope: UsageScope;
  fromVersion: string;
  toVersion: string;
  effectiveAt: number;
  pendingUsage: "drain_before_transition";
  reservations: "resolve_before_transition";
  existingCredits: "retain_original_terms";
};
export type UsageSubscriptionBinding = {
  subscriptionId: string;
  subscriptionItemId: string;
  stripePriceId: string;
  period: UsagePeriod;
  interval: "month";
};
export type UsageCreditProvenance = {
  grantId: string;
  purchasePaymentIntentId: string;
  currency: string;
  originalAmount: string;
  /** Quantity projections retain their original plan version and unit. */
  planVersion: string;
  reservationId: string;
  scaledQuantity: string;
};
export type UsageCorrectionOutcome = {
  correctionId: string;
  sourceEventId: string;
  state:
    | "requested"
    | "provider_accepted"
    | "confirmed"
    | "held"
    | "unsupported"
    | "invoice_adjustment_required";
  providerAdjustmentId: string | null;
  reason: string;
};
export type UsageReceipt = {
  eventId: string;
  identity: string;
  acceptedAt: number;
  delivery: import("./records.js").UsageDeliveryState;
};
export type UsageHistoryPage = {
  events: Array<{ receipt: UsageReceipt; record: PreparedUsageRecord }>;
  cursor: string | null;
  isDone: boolean;
};
export type UsageProviderCapabilities = {
  aggregation: "sum";
  scaledIntegerQuantities: true;
  realTimeBalance: false;
  eventCancellation: "provider_window";
  invoiceFinalization: "asynchronous";
};
/** Contract for host adapters; this interface does not supply a billing engine. */
export interface UsageContractPort {
  record(record: PreparedUsageRecord): Promise<UsageReceipt>;
  read(request: {
    scope: UsageScope;
    page: UsagePageRequest;
  }): Promise<UsageHistoryPage>;
  reconcile(request: {
    scope: UsageScope;
    period: UsagePeriod;
  }): Promise<UsageAvailability<UsageObservations>>;
  capabilities(
    scope: UsageScope,
  ): Promise<UsageAvailability<UsageProviderCapabilities>>;
}

const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pageSchema = z.strictObject({
  period: z.strictObject({ start: seconds, end: seconds }),
  limit: z.number().int().min(1).max(100),
  cursor: z.string().min(1).max(2048).nullable(),
});

export function validateUsagePageRequest(input: unknown): UsagePageRequest {
  const request = pageSchema.parse(input);
  if (request.period.end <= request.period.start)
    throw new Error("Usage period must have a positive duration");
  return request;
}

export function assertUsageReplay(
  original: PreparedUsageRecord,
  candidate: PreparedUsageRecord,
): void {
  const signature = (record: PreparedUsageRecord) =>
    JSON.stringify([
      record.schemaVersion,
      record.identity,
      record.sourceEventId,
      record.scope.livemode,
      record.scope.stripeAccountId,
      record.scope.customerAccount,
      record.scope.meterId,
      record.quantity,
      record.scaledQuantity,
      record.occurredAt,
      record.binding.stripeCustomerId,
      record.binding.stripePriceId,
      record.binding.eventName,
      record.binding.apiVersion,
      defineUsagePlan(record.binding.plan),
    ]);
  if (signature(original) !== signature(candidate))
    throw new Error("Conflicting usage replay");
}

export async function authorizeUsageRecord<Context, Result>(
  ctx: Context,
  policy: UsageAuthorization<Context>,
  input: unknown,
  accept: (record: PreparedUsageRecord) => Promise<Result>,
): Promise<Result> {
  const record = prepareUsageRecord(input);
  await policy.authorize(ctx, { scope: record.scope, operation: "record" });
  await policy.authorizeActivity(ctx, record);
  return accept(record);
}
