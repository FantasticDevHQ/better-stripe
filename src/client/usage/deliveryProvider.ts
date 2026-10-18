import Stripe from "stripe";
import type { StripeApiVersion } from "../stripe-types.js";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { resolveStripeApiVersion } from "../apiVersion.js";
import { scopeSchema, type PreparedUsageRecord } from "./records.js";
import { verifyRealm, verifyMeter, UsageCatalogError } from "./catalogTypes.js";
import { subscriptionSnapshot } from "../../component/usage/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
export const usageDeliveryRequest = z.strictObject({
  scope: scopeSchema,
  eventId: z.string().min(1).max(100),
  attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  definitionVersion: z.literal(1),
  apiVersion: z.string(),
  identifier: z
    .string()
    .regex(/^bs_usage_[a-zA-Z0-9_]+$/)
    .max(100),
});
export type UsageDeliveryRequest = z.infer<typeof usageDeliveryRequest>;
export type UsageDeliveryOutcome =
  | { status: "accepted"; created: number }
  | { status: "rate_limited" | "unavailable" | "unknown" | "rejected" };
export type UsageDeliveryProviderOptions = {
  stripeSecretKey?: string;
  httpClient?: Stripe.HttpClient;
};
/** Internal host action only. Options never enter component or Workflow state. */
export async function deliverUsageProvider(
  component: Component,
  ctx: RunCtx,
  input: UsageDeliveryRequest,
  options: UsageDeliveryProviderOptions,
): Promise<UsageDeliveryRequest & { outcome: UsageDeliveryOutcome }> {
  const args = usageDeliveryRequest.parse(input);
  const done = (outcome: UsageDeliveryOutcome) => ({ ...args, outcome });
  if (!options.stripeSecretKey) return done({ status: "unavailable" });
  let writing = false;
  try {
    const apiVersion = resolveStripeApiVersion(args.apiVersion);
    const stripe = new Stripe(options.stripeSecretKey, {
      apiVersion: apiVersion as StripeApiVersion,
      maxNetworkRetries: 0,
      timeout: 15000,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
    const read = () =>
      ctx.runQuery(componentRef(component, "usageDelivery/queries/snapshot"), {
        scope: args.scope,
        eventId: args.eventId,
      }) as Promise<{
        event: Doc<"usageEvents">;
        outbox: Doc<"usageOutbox">;
        billingCutoff: number | null;
      }>;
    const saved = await read(),
      record = JSON.parse(saved.event.recordJson) as PreparedUsageRecord;
    const eligible = (outbox: Doc<"usageOutbox">) =>
      outbox.state === "sending" &&
      !outbox.held &&
      outbox.attempts === args.attempt &&
      outbox.definitionVersion === args.definitionVersion &&
      outbox.providerIdentifier === args.identifier &&
      outbox.firstSendAt !== undefined &&
      Date.now() / 1000 - outbox.firstSendAt < 23 * 3600 &&
      (outbox.leaseUntil ?? 0) > Date.now() / 1000 + 60;
    if (
      !eligible(saved.outbox) ||
      (saved.billingCutoff !== null &&
        Date.now() / 1000 + 15 >= saved.billingCutoff) ||
      record.binding.apiVersion !== apiVersion ||
      JSON.stringify(record.scope) !== JSON.stringify(args.scope)
    )
      return done({ status: "unknown" });
    const now = Math.floor(Date.now() / 1000);
    if (record.occurredAt < now - 35 * 86400 || record.occurredAt > now + 300)
      return done({ status: "rejected" });
    await verifyRealm(stripe, {
      stripeAccountId: args.scope.stripeAccountId,
      livemode: args.scope.livemode,
    });
    const binding = subscriptionSnapshot(saved.event.subscriptionJson);
    const [meter, subscription] = await Promise.all([
      stripe.billing.meters.retrieve(args.scope.meterId),
      stripe.subscriptions.retrieve(binding.subscriptionId),
    ]);
    if (
      meter.id !== args.scope.meterId ||
      subscription.id !== binding.subscriptionId ||
      subscription.livemode !== args.scope.livemode ||
      subscription.customer_account !== args.scope.customerAccount ||
      (typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id) !== record.binding.stripeCustomerId
    )
      return done({ status: "rejected" });
    verifyMeter(meter, {
      scope: args.scope,
      plan: record.binding.plan,
      eventName: record.binding.eventName,
      displayName: meter.display_name,
    });
    const current = await read();
    if (
      !eligible(current.outbox) ||
      (current.billingCutoff !== null &&
        Date.now() / 1000 + 15 >= current.billingCutoff)
    )
      return done({ status: "unknown" });
    if (current.billingCutoff !== null) {
      const item = subscription.items.data.find(
        (item) => item.id === binding.subscriptionItemId,
      );
      if (
        subscription.status !== "active" ||
        subscription.items.has_more ||
        !item ||
        item.price.id !== binding.stripePriceId ||
        item.current_period_start !== binding.period.start ||
        item.current_period_end !== binding.period.end
      )
        return done({ status: "unavailable" });
    }
    writing = true;
    const response = await stripe.billing.meterEvents.create(
      {
        event_name: record.binding.eventName,
        identifier: args.identifier,
        timestamp: record.occurredAt,
        payload: {
          stripe_customer_id: record.binding.stripeCustomerId,
          value: record.scaledQuantity,
        },
      },
      { idempotencyKey: args.identifier },
    );
    if (
      response.identifier !== args.identifier ||
      response.event_name !== record.binding.eventName ||
      response.livemode !== args.scope.livemode ||
      response.timestamp !== record.occurredAt ||
      response.payload.stripe_customer_id !== record.binding.stripeCustomerId ||
      String(response.payload.value) !== record.scaledQuantity ||
      !Number.isSafeInteger(response.created) ||
      response.created < 0
    )
      return done({ status: "unknown" });
    return done({ status: "accepted", created: response.created });
  } catch (error) {
    if (!writing)
      return done({
        status:
          error instanceof UsageCatalogError &&
          error.code === "unsupported_scope"
            ? "rejected"
            : "unavailable",
      });
    const status =
      error instanceof Stripe.errors.StripeError ? error.statusCode : undefined;
    if (status === 429) return done({ status: "rate_limited" });
    if (status === 401 || status === 403)
      return done({ status: "unavailable" });
    const code =
      error instanceof Stripe.errors.StripeError ? error.code : undefined;
    if (
      status === 404 ||
      (status === 400 &&
        code !== undefined &&
        [
          "parameter_invalid_integer",
          "parameter_invalid_empty",
          "parameter_missing",
          "resource_missing",
        ].includes(code))
    )
      return done({ status: "rejected" });
    return done({ status: "unknown" });
  }
}
