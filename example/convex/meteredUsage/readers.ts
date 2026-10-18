import { v } from "convex/values";
import { action, query, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { demoActor } from "./authorization";
import { demoModel } from "./schema";
import { demoObservationUnavailable } from "./policy";
import { originalDemoRun, demoCreditPurchase } from "./original";
import type {
  UsageBillingSnapshot,
  UsageLocalSummary,
  UsageAvailability,
} from "@fantastic.dev/better-stripe/usage";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
const available = <T>(value: T): UsageAvailability<T> => ({
  status: "available",
  observedAt: Math.floor(Date.now() / 1000),
  value,
});
export const current = query({
  args: { actorId: v.id("users"), model: demoModel },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    await demoActor(ctx, args.actorId);
    const row = await ctx.db
      .query("meteredDemoRuns")
      .withIndex("by_actor_model", (q) =>
        q.eq("actorId", args.actorId).eq("model", args.model),
      )
      .order("desc")
      .first();
    return row ? JSON.stringify(row) : null;
  },
});
export const snapshot = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { run, meter } = await originalDemoRun(ctx, args);
    let summary: UsageAvailability<UsageLocalSummary>;
    try {
      summary = available(
        await stripe.usage.getSummary(ctx, {
          scope: meter.scope,
          period: meter.subscription.period,
          maxRecords: 100,
        }),
      );
    } catch {
      summary = demoObservationUnavailable();
    }
    const snapshot: UsageBillingSnapshot = {
      summary,
      provider: await stripe.usage.getProviderUsage(ctx, {
        ...meter,
        period: meter.subscription.period,
      }),
    };
    if (run.model === "prepaid") {
      const purchase = await ctx.runQuery(
        internal.meteredUsage.purchases.latest,
        args,
      );
      snapshot.purchase = purchase
        ? await stripe.usage.getCreditPurchase(
            ctx,
            demoCreditPurchase(meter, purchase),
          )
        : null;
      if (purchase && snapshot.purchase?.state === "ready") {
        try {
          snapshot.creditApplication =
            await stripe.usage.reconcileCreditPurchase(
              ctx,
              demoCreditPurchase(meter, purchase),
              { stripeSecretKey: env.STRIPE_SECRET_KEY },
            );
        } catch {
          snapshot.creditApplication = demoObservationUnavailable();
        }
      }
      try {
        snapshot.credits = available(
          await stripe.usage.getCreditBalance(ctx, meter),
        );
      } catch {
        snapshot.credits = demoObservationUnavailable();
      }
    } else {
      try {
        snapshot.allowance = available(
          await stripe.usage.getAllowanceStatus(ctx, meter),
        );
      } catch {
        snapshot.allowance = demoObservationUnavailable();
      }
    }
    return JSON.stringify(snapshot);
  },
});
export const history = action({
  args: { ...ref, limit: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter } = await originalDemoRun(ctx, args);
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
export const observe = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter } = await originalDemoRun(ctx, args);
    return JSON.stringify(
      await stripe.usage.observeProviderUsage(
        ctx,
        { ...meter, period: meter.subscription.period },
        { stripeSecretKey: env.STRIPE_SECRET_KEY },
      ),
    );
  },
});
