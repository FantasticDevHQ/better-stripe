import {
  authorizeUsageRecord,
  defineUsagePlan,
  validateUsagePageRequest,
  type UsageAuthorization,
  type UsageContractPort,
  type UsageScope,
} from "@fantastic.dev/better-stripe/usage";

type HostContext = {
  userId: string;
  customerAccount: string;
  activityId: string;
  occurredAt: number;
};

// These values must come from the authenticated actor and persisted activity.
const policy: UsageAuthorization<HostContext> = {
  async authorize(ctx, { scope }) {
    if (!ctx.userId || scope.customerAccount !== ctx.customerAccount)
      throw new Error("Unauthorized usage scope");
  },
  async authorizeActivity(ctx, record) {
    if (record.sourceEventId !== ctx.activityId || record.quantity !== "1")
      throw new Error("Activity is not billable under these terms");
  },
};

/** Compile this against the packed package, not a source alias. */
export async function integrateEachModel(
  ctx: HostContext,
  port: UsageContractPort,
  scope: UsageScope,
  binding: {
    stripeCustomerId: string;
    stripePriceId: string;
    eventName: string;
  },
) {
  const common = {
    key: "requests",
    version: "v1",
    unit: { name: "request", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "2" },
  };
  // Real integrations select one immutable binding for an activity. These
  // alternatives show the same host contract for each supported model.
  const plans = [
    { ...common, model: "pay_as_you_go" },
    {
      ...common,
      model: "included_overage",
      includedQuantity: "100",
      reset: "billing_period",
    },
    { ...common, model: "prepaid", insufficientBalance: "reject" },
  ].map(defineUsagePlan);
  const recordWith = (plan: (typeof plans)[number]) =>
    authorizeUsageRecord(
      ctx,
      policy,
      {
        scope,
        binding: { ...binding, plan },
        sourceEventId: ctx.activityId,
        quantity: "1",
        occurredAt: ctx.occurredAt,
      },
      (record) => port.record(record),
    );
  const page = validateUsagePageRequest({
    period: { start: ctx.occurredAt, end: ctx.occurredAt + 1 },
    limit: 20,
    cursor: null,
  });
  const read = async () => {
    await policy.authorize(ctx, { scope, operation: "read" });
    return port.read({ scope, page });
  };
  const reconcile = async () => {
    await policy.authorize(ctx, { scope, operation: "reconcile" });
    return port.reconcile({ scope, period: page.period });
  };
  // Return alternatives. Never submit the same activity to all models.
  return {
    payAsYouGo: () => recordWith(plans[0]),
    included: () => recordWith(plans[1]),
    prepaid: () => recordWith(plans[2]),
    read,
    reconcile,
  };
}

import { BetterStripe } from "@fantastic.dev/better-stripe";
import { internalActionGeneric } from "convex/server";
import {
  usageDeliveryArgs,
  usageDeliveryResult,
  type UsageDeliveryStartOptions,
} from "@fantastic.dev/better-stripe/usage";

export function registerInternalUsageProvider(
  stripe: BetterStripe,
  resolveSecret: () => string | undefined,
) {
  return internalActionGeneric({
    args: usageDeliveryArgs,
    returns: usageDeliveryResult,
    handler: (ctx, request) =>
      stripe.usage.deliver(ctx, request, { stripeSecretKey: resolveSecret() }),
  });
}
export function startNativeUsageDelivery(
  stripe: BetterStripe,
  ctx: Parameters<BetterStripe["usage"]["startDelivery"]>[0],
  options: UsageDeliveryStartOptions,
) {
  return stripe.usage.startDelivery(ctx, options);
}

import type { UsageReconciliationOptions } from "@fantastic.dev/better-stripe/usage";
export function readUsageStatus(
  stripe: BetterStripe,
  ctx: Parameters<BetterStripe["usage"]["getSummary"]>[0],
  request: UsageReconciliationOptions,
) {
  return stripe.usage.getReconciliation(ctx, request);
}
export function readNativeInvoice(
  stripe: BetterStripe,
  ctx: Parameters<BetterStripe["usage"]["readInvoiceUsage"]>[0],
  request: UsageReconciliationOptions & { invoiceId?: string },
  resolveSecret: () => string | undefined,
) {
  return stripe.usage.readInvoiceUsage(ctx, request, {
    stripeSecretKey: resolveSecret(),
  });
}
