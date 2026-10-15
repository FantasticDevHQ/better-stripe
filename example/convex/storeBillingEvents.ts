import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";

export const process = internalAction({
  args: { type: v.string(), objectId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const raw = getStripeClient();
    if (args.type.startsWith("customer.subscription.")) {
      await ctx.runAction(internal.storePlanActions.refreshSubscription, {
        subscriptionId: args.objectId,
      });
    } else if (args.type.startsWith("invoice.")) {
      const invoice = await raw.invoices.retrieve(args.objectId);
      const subscription = invoice.parent?.subscription_details?.subscription;
      if (!subscription) return null;
      const subscriptionId =
        typeof subscription === "string" ? subscription : subscription.id;
      const sub = await raw.subscriptions.retrieve(subscriptionId);
      if (sub.metadata.storeBilling === "plan_v1") {
        if (
          args.type === "invoice.created" &&
          invoice.billing_reason !== "subscription_cycle"
        )
          return null;
        if (args.type === "invoice.created")
          await ctx.runAction(internal.sellerCostActions.attachToInvoice, {
            invoiceId: invoice.id,
            sellerId: sub.metadata
              .sellerId as import("./_generated/dataModel").Id<"users">,
          });
        else {
          await ctx.runAction(internal.recoveryInvoices.reconcile, {
            invoiceId: invoice.id,
            sellerId: sub.metadata
              .sellerId as import("./_generated/dataModel").Id<"users">,
          });
          await ctx.runAction(internal.storePlanActions.refreshSubscription, {
            subscriptionId,
          });
        }
      } else if (
        sub.metadata.storeBilling === "sale_v1" &&
        invoice.status === "paid"
      ) {
        const payments = await raw.invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 100,
        });
        for (const row of payments.data) {
          const pi = row.payment.payment_intent;
          if (pi)
            await ctx.runAction(internal.storeSaleSettlement.settleWhenReady, {
              paymentIntentId: typeof pi === "string" ? pi : pi.id,
              subscriptionId,
              invoiceId: invoice.id,
            });
        }
      }
    } else if (args.type.startsWith("refund.")) {
      const refund = await raw.refunds.retrieve(args.objectId);
      const payment = refund.payment_intent;
      if (
        payment &&
        ["succeeded", "failed", "canceled"].includes(refund.status ?? "")
      )
        await ctx.runAction(internal.sellerCostActions.reconcileWhenReady, {
          paymentIntentId: typeof payment === "string" ? payment : payment.id,
        });
    } else if (args.type.startsWith("charge.dispute.")) {
      const dispute = await raw.disputes.retrieve(args.objectId);
      const payment = dispute.payment_intent;
      if (payment)
        await ctx.runAction(internal.sellerCostActions.reconcileWhenReady, {
          paymentIntentId: typeof payment === "string" ? payment : payment.id,
        });
    } else if (args.type === "payment_intent.succeeded") {
      await ctx.runAction(internal.storeSaleSettlement.settleWhenReady, {
        paymentIntentId: args.objectId,
      });
    } else if (args.type === "charge.updated") {
      const charge = await raw.charges.retrieve(args.objectId);
      const pi = charge.payment_intent;
      if (pi)
        await ctx.runAction(internal.storeSaleSettlement.settleWhenReady, {
          paymentIntentId: typeof pi === "string" ? pi : pi.id,
        });
    }
    return null;
  },
});

/** Reconcile a previously delivered sandbox event after fixing an example hook. */
export const replaySandboxEvent = internalAction({
  args: { eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { assertTestModeStripeKey } = await import("./authz");
    const { env } = await import("./_generated/server");
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const event = await getStripeClient().events.retrieve(args.eventId);
    if (!("id" in event.data.object))
      throw new Error("Event has no object ID.");
    await ctx.runAction(internal.storeBillingEvents.process, {
      type: event.type,
      objectId: event.data.object.id,
    });
    return null;
  },
});
