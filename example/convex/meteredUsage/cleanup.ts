import { v } from "convex/values";
import { action, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import { originalDemoRun, demoCreditPurchase } from "./original";
import { freezeDemoBilling } from "./billingPreflight";
import { assertDemoCleanupReady } from "./cleanupGuard";
import { demoSubscriptionRef } from "./billingSources";
import { selectDemoInvoice } from "./invoiceGuard";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
/** Stop owned recurring resources; retain payer, clock, paid evidence and component history. */
export const archive = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const saved = await originalDemoRun(ctx, args);
    if (saved.run.archived)
      return saved.run.cleanupJson ?? '{"status":"archived"}';
    const { run, meter, provider, purchases } = await freezeDemoBilling(
      ctx,
      args,
    );
    assertDemoCleanupReady(
      run.billingJson ? JSON.parse(run.billingJson) : null,
    );
    const options = { stripeSecretKey: env.STRIPE_SECRET_KEY };
    const raw = getStripeClient();
    const subscriptionRef = demoSubscriptionRef({
      scope: meter.scope,
      requestId: provider.requestId,
    });
    const save = async (status: string, archived = false) => {
      const cleanupJson = JSON.stringify({
        status,
        retained:
          "Native payer, clock, paid evidence and all component history",
        newRunAllowed: archived,
      });
      await ctx.runMutation(internal.meteredUsage.state.saveCleanup, {
        ...args,
        cleanupJson,
        archived,
      });
      return cleanupJson;
    };
    if (run.model === "prepaid") {
      for (const purchase of purchases)
        await stripe.usage.reconcileCreditPurchase(
          ctx,
          demoCreditPurchase(meter, purchase),
          options,
        );
      // Package validates complete fresh native invoices, zero backing and no liabilities.
      await stripe.usage.closeCreditAccount(ctx, meter);
    }
    let current = await stripe.usage.observeSubscription(
      ctx,
      subscriptionRef,
      options,
    );
    const item = current.bindings.find(
      (row) => row.scope.meterId === meter.scope.meterId,
    );
    if (!item) throw new Error("Original subscription binding is unavailable.");
    if (current.status !== "canceled") {
      await stripe.usage.setCancelAtPeriodEnd(
        ctx,
        {
          ...subscriptionRef,
          operationId: `demo_archive_${run._id}`,
          cancelAtPeriodEnd: true,
        },
        options,
      );
      const clock = await raw.testHelpers.testClocks.retrieve(provider.clockId);
      if (clock.livemode || clock.id !== provider.clockId)
        throw new Error("Original test clock is unavailable.");
      if (clock.status !== "ready") return save("advancing_to_cancellation");
      const target = item.subscription.period.end + 7200;
      if (clock.frozen_time < target) {
        await raw.testHelpers.testClocks.advance(
          clock.id,
          { frozen_time: target },
          { idempotencyKey: `bs_demo_${run._id}_archive_clock` },
        );
        return save("advancing_to_cancellation");
      }
      current = await stripe.usage.observeSubscription(
        ctx,
        subscriptionRef,
        options,
      );
      if (current.status !== "canceled")
        return save("waiting_for_cancellation");
    }
    const end = Math.max(
      ...current.bindings.map((row) => row.subscription.period.end),
    );
    const page = await raw.invoices.list({
      customer_account: meter.scope.customerAccount,
      subscription: meter.subscription.subscriptionId,
      limit: 100,
    });
    let invoice = selectDemoInvoice(page, {
      customerAccount: meter.scope.customerAccount,
      customerId: meter.binding.stripeCustomerId,
      subscriptionId: meter.subscription.subscriptionId,
      periodEnd: end,
    });
    if (!invoice) return save("waiting_for_final_invoice");
    if (invoice.status === "draft")
      invoice = await raw.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: false },
        { idempotencyKey: `bs_demo_${run._id}_archive_finalize` },
      );
    if (invoice.status !== "paid" || invoice.amount_remaining !== 0)
      throw new Error("Resolve the final native invoice before archiving.");
    await stripe.usage.retireSubscription(
      ctx,
      { ...subscriptionRef, invoiceId: invoice.id },
      options,
    );
    const product = await raw.products.retrieve(provider.productId);
    if (product.livemode || product.metadata.bsUsageDemo !== run._id)
      throw new Error("Owned sandbox product provenance is unavailable.");
    await raw.prices.update(meter.binding.stripePriceId, { active: false });
    const nativeMeter = await raw.billing.meters.retrieve(meter.scope.meterId);
    if (nativeMeter.status === "active")
      await raw.billing.meters.deactivate(nativeMeter.id);
    await raw.products.update(product.id, { active: false });
    return save("archived", true);
  },
});
