import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { env } from "../_generated/server";
import { originalDemoRun, demoCreditPurchase } from "./original";
import { assertDemoBillingReady } from "./billingGuard";
import type { DemoRef } from "./resources";
/** Fence new host work before reading financial state; retries retain every original identity. */
export async function freezeDemoBilling(ctx: ActionCtx, ref: DemoRef) {
  await ctx.runMutation(internal.meteredUsage.state.freezeBilling, ref);
  const original = await originalDemoRun(ctx, ref);
  const { run, meter } = original;
  const observation = {
    ...meter,
    period: meter.subscription.period,
    maxRecords: 100,
  };
  const result = await stripe.usage.reconcile(ctx, observation, {
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  const corrections = await stripe.usage.readCorrectionPeriodHistory(ctx, {
    scope: meter.scope,
    period: meter.subscription.period,
    limit: 100,
    cursor: null,
  });
  const balance =
    run.model === "prepaid"
      ? await stripe.usage.getCreditBalance(ctx, meter)
      : await stripe.usage.getAllowanceStatus(ctx, meter);
  if (!balance) throw new Error("Original allowance is unavailable.");
  assertDemoBillingReady({
    local: result.local,
    comparison: result.comparison,
    reservedQuantity: balance.reservedQuantity,
    corrections,
  });
  for (const activityId of run.correctionActivityIds ?? []) {
    const work = await ctx.runQuery(internal.meteredUsage.state.getActivity, {
      ...ref,
      activityId,
    });
    if (!work.receiptId)
      throw new Error("Original correction source is unavailable.");
    const correction = await stripe.usage.getCorrection(ctx, {
      scope: meter.scope,
      eventId: work.receiptId,
      correctionId: `demo_cancel_${work._id}`,
    });
    if (correction?.state !== "confirmed")
      throw new Error("Resolve the retained correction intent before billing.");
  }
  const purchases = await ctx.runQuery(
    internal.meteredUsage.purchases.list,
    ref,
  );
  for (const purchase of purchases) {
    const saved = await stripe.usage.getCreditPurchase(
      ctx,
      demoCreditPurchase(meter, purchase),
    );
    if (!saved || (saved.state !== "ready" && saved.state !== "canceled"))
      throw new Error(
        "Resolve every retained purchase before advancing the clock.",
      );
  }
  return { ...original, purchases };
}
