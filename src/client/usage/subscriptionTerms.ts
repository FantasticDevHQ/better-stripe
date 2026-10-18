import { z } from "zod";
import {
  prepareUsageRecord,
  type PreparedUsageRecord,
  type UsageScope,
} from "./records.js";
import type { UsageSubscriptionBinding } from "./boundaries.js";
export type UsageSubscriptionOptions = {
  requestId: string;
  meters: Array<{
    scope: UsageScope;
    binding: Omit<PreparedUsageRecord["binding"], "apiVersion"> & {
      apiVersion?: string;
    };
  }>;
  fixedPriceIds?: string[];
  collection:
    | { method: "send_invoice"; daysUntilDue: number }
    | { method: "charge_automatically"; defaultPaymentMethod: string }
    | { method: "checkout"; successUrl: string; cancelUrl: string };
};
const id = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[a-zA-Z0-9]+$`))
    .max(100);
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  meters: z
    .array(z.strictObject({ scope: z.unknown(), binding: z.unknown() }))
    .min(1)
    .max(10),
  fixedPriceIds: z.array(id("price")).max(10).default([]),
  collection: z.discriminatedUnion("method", [
    z.strictObject({
      method: z.literal("send_invoice"),
      daysUntilDue: z.number().int().min(1).max(365),
    }),
    z.strictObject({
      method: z.literal("charge_automatically"),
      defaultPaymentMethod: id("pm"),
    }),
    z.strictObject({
      method: z.literal("checkout"),
      successUrl: z.url({ protocol: /^https?$/ }).max(2048),
      cancelUrl: z.url({ protocol: /^https?$/ }).max(2048),
    }),
  ]),
});
export function subscriptionTerms(input: unknown) {
  const parsed = requestSchema.parse(input);
  const meters = parsed.meters.map((meter) => {
    const { scope, binding } = prepareUsageRecord({
      ...meter,
      sourceEventId: "subscription",
      quantity: "0",
      occurredAt: 0,
    });
    return { scope, binding };
  });
  const first = meters[0],
    prices = new Set(parsed.fixedPriceIds),
    meterIds = new Set<string>();
  if (prices.size !== parsed.fixedPriceIds.length)
    throw new Error("Duplicate fixed price");
  for (const meter of meters) {
    if (
      meter.scope.stripeAccountId !== first.scope.stripeAccountId ||
      meter.scope.livemode !== first.scope.livemode ||
      meter.scope.customerAccount !== first.scope.customerAccount ||
      meter.binding.stripeCustomerId !== first.binding.stripeCustomerId ||
      meter.binding.apiVersion !== first.binding.apiVersion ||
      meter.binding.plan.rate.currency !== first.binding.plan.rate.currency ||
      prices.has(meter.binding.stripePriceId) ||
      meterIds.has(meter.scope.meterId)
    )
      throw new Error("Incompatible or duplicate usage subscription bindings");
    prices.add(meter.binding.stripePriceId);
    meterIds.add(meter.scope.meterId);
  }
  return { ...parsed, meters };
}
export type UsageSubscriptionTerms = ReturnType<typeof subscriptionTerms>;
export function subscriptionScope(terms: UsageSubscriptionTerms) {
  const { stripeAccountId, customerAccount, livemode } = terms.meters[0].scope;
  return { stripeAccountId, customerAccount, livemode };
}
export const subscriptionScopeSchema = z.strictObject({
  stripeAccountId: id("acct"),
  customerAccount: id("acct"),
  livemode: z.boolean(),
});
const nativeSchema = z.object({
  id: id("sub"),
  livemode: z.boolean(),
  customer_account: id("acct"),
  customer: z.union([id("cus"), z.object({ id: id("cus") })]),
  status: z.enum([
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
  ]),
  currency: z.string().regex(/^[a-z]{3}$/),
  collection_method: z.enum(["send_invoice", "charge_automatically"]),
  days_until_due: z.number().int().min(1).max(365).nullable().default(null),
  default_payment_method: z
    .union([id("pm"), z.object({ id: id("pm") })])
    .nullable()
    .default(null),
  billing_mode: z.object({ type: z.enum(["classic", "flexible"]) }),
  cancel_at_period_end: z.boolean(),
  cancel_at: seconds.nullable().default(null),
  items: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z.object({
          id: id("si"),
          current_period_start: seconds,
          current_period_end: seconds,
          quantity: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER)
            .nullable()
            .optional(),
          price: z.object({
            id: id("price"),
            currency: z.string(),
            recurring: z.object({
              interval: z.literal("month"),
              interval_count: z.literal(1),
              usage_type: z.enum(["metered", "licensed"]),
              meter: z.string().nullable().optional(),
            }),
            unit_amount_decimal: z.unknown().optional(),
          }),
        }),
      )
      .min(1)
      .max(20),
  }),
});
export function subscriptionEvidence(input: unknown) {
  const sub = nativeSchema.parse(input);
  return {
    ...sub,
    items: {
      ...sub.items,
      data: sub.items.data.map((item) => {
        const amount = item.price.unit_amount_decimal?.toString() ?? null;
        if (amount !== null && !/^\d+(\.\d{1,12})?$/.test(amount))
          throw new Error("Invalid native rate precision");
        return {
          ...item,
          price: { ...item.price, unit_amount_decimal: amount },
        };
      }),
    },
  };
}
export function subscriptionView(
  input: unknown,
  terms: UsageSubscriptionTerms,
) {
  const sub = subscriptionEvidence(input),
    first = terms.meters[0];
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (
    sub.customer_account !== first.scope.customerAccount ||
    customer !== first.binding.stripeCustomerId ||
    sub.livemode !== first.scope.livemode ||
    sub.currency !== first.binding.plan.rate.currency ||
    sub.billing_mode.type !== "flexible"
  )
    throw new Error("Native subscription scope or billing mode mismatch");
  const defaultPaymentMethod =
    typeof sub.default_payment_method === "string"
      ? sub.default_payment_method
      : (sub.default_payment_method?.id ?? null);
  if (
    terms.collection.method === "send_invoice"
      ? sub.collection_method !== "send_invoice" ||
        sub.days_until_due !== terms.collection.daysUntilDue
      : sub.collection_method !== "charge_automatically" ||
        (terms.collection.method === "charge_automatically" &&
          defaultPaymentMethod !== terms.collection.defaultPaymentMethod)
  )
    throw new Error("Native subscription collection terms changed");
  const expectedPrices = new Set([
    ...terms.fixedPriceIds,
    ...terms.meters.map((m) => m.binding.stripePriceId),
  ]);
  const seen = new Set<string>();
  const items = sub.items.data.map((item) => {
    if (
      item.current_period_end <= item.current_period_start ||
      !expectedPrices.has(item.price.id) ||
      seen.has(item.price.id) ||
      item.price.currency !== sub.currency
    )
      throw new Error("Native subscription items changed or are incomplete");
    seen.add(item.price.id);
    const metered = terms.meters.find(
      (m) => m.binding.stripePriceId === item.price.id,
    );
    if (
      metered
        ? item.price.recurring.usage_type !== "metered" ||
          item.price.recurring.meter !== metered.scope.meterId
        : item.price.recurring.usage_type !== "licensed"
    )
      throw new Error("Native subscription meter mismatch");
    const amount = item.price.unit_amount_decimal?.toString() ?? null;
    if (amount !== null && !/^\d+(\.\d{1,12})?$/.test(amount))
      throw new Error("Invalid native rate precision");
    return {
      id: item.id,
      stripePriceId: item.price.id,
      meterId: metered?.scope.meterId ?? null,
      period: {
        start: item.current_period_start,
        end: item.current_period_end,
      },
      quantity:
        item.quantity === undefined || item.quantity === null
          ? null
          : String(item.quantity),
      unitAmountDecimal: amount,
    };
  });
  if (seen.size !== expectedPrices.size)
    throw new Error("Native subscription has missing items");
  const bindings = terms.meters.map((meter) => {
    const item = items.find(
      (i) => i.stripePriceId === meter.binding.stripePriceId,
    )!;
    const subscription: UsageSubscriptionBinding = {
      subscriptionId: sub.id,
      subscriptionItemId: item.id,
      stripePriceId: item.stripePriceId,
      period: item.period,
      interval: "month",
    };
    return { ...meter, subscription };
  });
  return {
    subscriptionId: sub.id,
    status: sub.status,
    currency: sub.currency,
    billingMode: sub.billing_mode.type,
    collection: {
      method: sub.collection_method,
      daysUntilDue: sub.days_until_due,
      defaultPaymentMethod,
    },
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: sub.cancel_at,
    items,
    bindings,
  };
}
export type UsageSubscriptionView = ReturnType<typeof subscriptionView>;
export function closeoutPolicy(input: {
  queued: number;
  unknown: number;
  reservations: number;
  finalized: boolean;
}) {
  for (const count of [input.queued, input.unknown, input.reservations])
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid closeout counters");
  const reason =
    input.queued || input.unknown
      ? "pending_usage"
      : input.reservations
        ? "pending_reservations"
        : !input.finalized
          ? "invoice_not_finalized"
          : "finalized_observation";
  return {
    ready: reason === "finalized_observation",
    reason,
    paymentEvidence: "not_resolved" as const,
  };
}
