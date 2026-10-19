import { v } from "convex/values";
import { action, env } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { originalEnrollment } from "./native";
import { enrollmentRef } from "./schema";
import type {
  UsageAvailability,
  UsageBillingSnapshot,
  UsageSubscriptionView,
} from "@fantastic.dev/better-stripe/usage";
const available = <T>(value: T): UsageAvailability<T> => ({
  status: "available",
  observedAt: Math.floor(Date.now() / 1000),
  value,
});
export const snapshot = action({
  args: enrollmentRef,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { enrollment } = await originalEnrollment(ctx, args);
    if (!enrollment.providerJson)
      throw new Error("Finish checkout and refresh your enrollment.");
    const subscription = JSON.parse(
      enrollment.providerJson,
    ) as UsageSubscriptionView;
    const meter = subscription.bindings[0];
    const snapshot: UsageBillingSnapshot = {
      summary: available(
        await stripe.usage.getSummary(ctx, {
          scope: meter.scope,
          period: meter.subscription.period,
          maxRecords: 100,
        }),
      ),
      provider: await stripe.usage.observeProviderUsage(
        ctx,
        { ...meter, period: meter.subscription.period },
        { stripeSecretKey: env.STRIPE_SECRET_KEY },
      ),
      ...(meter.binding.plan.model === "prepaid"
        ? {
            credits: available(await stripe.usage.getCreditBalance(ctx, meter)),
          }
        : {
            allowance: available(
              await stripe.usage.getAllowanceStatus(ctx, meter),
            ),
          }),
    };
    return JSON.stringify(snapshot);
  },
});
export const history = action({
  args: {
    ...enrollmentRef,
    limit: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { enrollment } = await originalEnrollment(ctx, args);
    if (!enrollment.providerJson)
      throw new Error("Finish checkout and refresh your enrollment.");
    const meter = (JSON.parse(enrollment.providerJson) as UsageSubscriptionView)
      .bindings[0];
    const page = await stripe.usage.read(ctx, {
      scope: meter.scope,
      page: {
        period: meter.subscription.period,
        limit: args.limit,
        cursor: args.cursor,
      },
    });
    return JSON.stringify(
      available({
        records: page.events,
        cursor: page.cursor,
        isDone: page.isDone,
        complete: true,
      }),
    );
  },
});
/** Native invoice estimate, including the fixed fee. It is never cash or transfer authority. */
export const preview = action({
  args: enrollmentRef,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { enrollment } = await originalEnrollment(ctx, args);
    if (!enrollment.providerJson)
      throw new Error("Finish checkout and refresh your enrollment.");
    const meter = (JSON.parse(enrollment.providerJson) as UsageSubscriptionView)
      .bindings[0];
    return JSON.stringify(
      await stripe.usage.readInvoiceUsage(
        ctx,
        { ...meter, period: meter.subscription.period },
        { stripeSecretKey: env.STRIPE_SECRET_KEY },
      ),
    );
  },
});
