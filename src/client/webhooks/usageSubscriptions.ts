import type Stripe from "stripe";
import type { WebhookContext } from "./helpers.js";
import { componentRef } from "./helpers.js";
import type { RunCtx } from "../helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import {
  refreshManagedSubscription,
  observeManagedInvoice,
} from "../usage/subscriptionLifecycle.js";
/** Re-read native state: an old signed webhook payload cannot rewind the mirror. */
export async function syncManagedUsageEvent(
  whCtx: WebhookContext,
  event: Stripe.Event,
) {
  const object = event.data.object;
  const subscriptionEvent = event.type.startsWith("customer.subscription.");
  const invoiceEvent = event.type.startsWith("invoice.");
  if (!subscriptionEvent && !invoiceEvent) return;
  const sub = subscriptionEvent ? (object as Stripe.Subscription) : null;
  const invoice = invoiceEvent ? (object as Stripe.Invoice) : null;
  const nativeId =
    sub?.id ??
    (typeof invoice?.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : invoice?.parent?.subscription_details?.subscription?.id);
  if (!nativeId) return;
  const key =
    sub?.metadata?.bsUsageIntent ??
    invoice?.parent?.subscription_details?.metadata?.bsUsageIntent;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return;
  const row = (await whCtx.ctx.runQuery(
    componentRef(whCtx.component, "usageSubscriptions/queries/lookup"),
    { key },
  )) as Doc<"usageSubscriptionIntents"> | null;
  const rows = row ? [row] : [];
  if (!rows.length) return;
  try {
    if (
      rows.length !== 1 ||
      (rows[0].providerId && rows[0].providerId !== nativeId)
    )
      throw new Error("Ambiguous managed subscription");
    const row = rows[0],
      terms = JSON.parse(row.termsJson);
    if (
      event.livemode !== terms.meters[0].scope.livemode ||
      (event.account && event.account !== terms.meters[0].scope.stripeAccountId)
    )
      throw new Error("Managed event realm mismatch");
    const ctx = whCtx.ctx as RunCtx;
    if (sub) {
      // Metadata discovers a Checkout subscription even before its completion webhook.
      await refreshManagedSubscription(whCtx.stripe, whCtx.component, ctx, {
        ...row,
        providerId: nativeId,
      });
    } else if (invoice) {
      const source = row.providerId ? row : { ...row, providerId: nativeId };
      if (!source.viewJson)
        await refreshManagedSubscription(
          whCtx.stripe,
          whCtx.component,
          ctx,
          source,
        );
      const fresh = (await whCtx.ctx.runQuery(
        componentRef(whCtx.component, "usageSubscriptions/queries/lookup"),
        { key: row.key },
      )) as Doc<"usageSubscriptionIntents">;
      await observeManagedInvoice(
        whCtx.stripe,
        whCtx.component,
        ctx,
        fresh,
        invoice.id,
      );
    }
  } catch {
    throw new Error("Native usage lifecycle observation unavailable");
  }
}
