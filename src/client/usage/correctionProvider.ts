import { locallyCancelable } from "./correctionEligibility.js";
import Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { PreparedUsageRecord } from "./records.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { verifyRealm, verifyMeter } from "./catalogTypes.js";
import { verifyCreditDelivery } from "./creditDelivery.js";
import { subscriptionSnapshot } from "../../component/usage/helpers.js";
import {
  correctionRequest,
  correctionView,
  type UsageCorrectionOptions,
} from "./correctionTerms.js";
import type { correctionOutcome } from "./correctionProofs.js";
import type { z } from "zod";
type Outcome = z.infer<typeof correctionOutcome>;
const customerId = (customer: string | { id: string } | null) =>
  typeof customer === "string" ? customer : customer?.id;
async function finalizedInvoice(
  stripe: Stripe,
  record: PreparedUsageRecord,
  subscriptionId: string,
  receivedAt: number,
) {
  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    limit: 100,
  });
  if (invoices.has_more !== false) return { held: true as const };
  for (const invoice of invoices.data) {
    if (
      !/^in_[a-zA-Z0-9]+$/.test(invoice.id) ||
      invoice.currency !== record.binding.plan.rate.currency ||
      invoice.parent?.type !== "subscription_details" ||
      (typeof invoice.parent.subscription_details?.subscription === "string"
        ? invoice.parent.subscription_details.subscription
        : invoice.parent.subscription_details?.subscription?.id) !==
        subscriptionId ||
      invoice.livemode !== record.scope.livemode ||
      invoice.customer_account !== record.scope.customerAccount ||
      customerId(invoice.customer) !== record.binding.stripeCustomerId
    )
      return { held: true as const };
    if (invoice.status === "draft") continue;
    const finalizedAt = invoice.status_transitions?.finalized_at;
    if (
      !["open", "paid", "void", "uncollectible"].includes(
        invoice.status ?? "",
      ) ||
      !Number.isSafeInteger(finalizedAt) ||
      finalizedAt! < 0
    )
      return { held: true as const };
    if (finalizedAt! < receivedAt) continue;
    if (invoice.lines.has_more !== false) return { held: true as const };
    for (const line of invoice.lines.data) {
      const priceId = line.pricing?.price_details?.price;
      if (!priceId) return { held: true as const };
      if (priceId !== record.binding.stripePriceId) continue;
      if (
        !Number.isSafeInteger(line.period?.start) ||
        !Number.isSafeInteger(line.period?.end) ||
        line.period.end <= line.period.start
      )
        return { held: true as const };
      if (
        line.period.start > record.occurredAt ||
        line.period.end <= record.occurredAt
      )
        continue;
      const quantity =
        line.quantity_decimal != null
          ? line.quantity_decimal.toString()
          : typeof line.quantity === "number" &&
              Number.isSafeInteger(line.quantity) &&
              line.quantity >= 0
            ? String(line.quantity)
            : null;
      if (
        quantity === null ||
        quantity.length > 64 ||
        !/^(0|[1-9]\d*)(\.\d+)?$/.test(quantity)
      )
        return { held: true as const };
      if (!/^0(?:\.0+)?$/.test(quantity))
        return { held: false as const, invoiceId: invoice.id };
    }
  }
  return { held: false as const };
}
/** All native context comes from the immutable component event, never browser claims. */
export async function requestUsageCorrection(
  component: Component,
  ctx: RunCtx,
  input: UsageCorrectionOptions,
  options: UsageDeliveryProviderOptions = {},
) {
  const request = correctionRequest.parse(input);
  let row = (await runMutationOrThrow(
    ctx,
    componentRef(component, "usageCorrections/mutations/prepare"),
    { inputJson: JSON.stringify(request) },
  )) as Doc<"usageCorrections">;
  const claimed = (await runMutationOrThrow(
    ctx,
    componentRef(component, "usageCorrections/mutations/claim"),
    { key: row.key },
  )) as { kind: "ready" | "done" | "busy"; attempt: number };
  const read = async () =>
    (await ctx.runQuery(
      componentRef(component, "usageCorrections/queries/get"),
      {
        scope: request.scope,
        eventId: request.eventId,
        correctionId: request.correctionId,
      },
    )) as Doc<"usageCorrections">;
  if (claimed.kind !== "ready") return correctionView(await read());
  const save = async (outcome: Outcome) => {
    row = (await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCorrections/mutations/save"),
      {
        key: row.key,
        attempt: claimed.attempt,
        outcomeJson: JSON.stringify(outcome),
      },
    )) as Doc<"usageCorrections">;
    return correctionView(row);
  };
  if (!options.stripeSecretKey)
    return save({ status: "held", reason: "provider_unavailable" });
  const record = JSON.parse(row.recordJson) as PreparedUsageRecord,
    subscription = subscriptionSnapshot(row.subscriptionJson);
  const stripe = new Stripe(options.stripeSecretKey, {
    apiVersion: record.binding.apiVersion as StripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 15000,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  let writing = false,
    outcome: Outcome;
  try {
    await verifyRealm(stripe, {
      stripeAccountId: record.scope.stripeAccountId,
      livemode: record.scope.livemode,
    });
    const customer = await stripe.customers.retrieve(
      record.scope.customerAccount,
    );
    if (
      customer.deleted ||
      customer.id !== record.binding.stripeCustomerId ||
      customer.customer_account !== record.scope.customerAccount ||
      customer.livemode !== record.scope.livemode
    )
      throw new Error("Native correction payer mismatch");
    const saved = (await ctx.runQuery(
      componentRef(component, "usageDelivery/queries/snapshot"),
      { scope: request.scope, eventId: request.eventId },
    )) as { event: Doc<"usageEvents">; outbox: Doc<"usageOutbox"> };
    if (saved.outbox.correctionKey !== row.key)
      throw new Error("Native correction intent mismatch");
    const unsent = locallyCancelable(saved.outbox);
    if (unsent) {
      await verifyCreditDelivery(stripe, component, ctx, saved.event, record);
      return save({ status: "local_complete", creditBackingVerified: true });
    }
    if (
      !saved.outbox.receipt ||
      saved.outbox.state === "sending" ||
      saved.outbox.state === "unknown"
    )
      return save({ status: "held", reason: "original_delivery_unresolved" });
    const now = Date.now() / 1000;
    if (now - saved.outbox.receipt.created >= 23 * 3600)
      return save({
        status: "invoice_adjustment_required",
        reason: "native_cancellation_expired",
      });
    if (now + 15 >= subscription.period.end - 60)
      return save({
        status: "invoice_adjustment_required",
        reason: "billing_period_closed",
      });
    const [meter, native] = await Promise.all([
      stripe.billing.meters.retrieve(record.scope.meterId),
      stripe.subscriptions.retrieve(subscription.subscriptionId),
    ]);
    if (meter.id !== record.scope.meterId)
      throw new Error("Native correction meter identity mismatch");
    verifyMeter(meter, {
      scope: record.scope,
      plan: record.binding.plan,
      eventName: record.binding.eventName,
      displayName: meter.display_name,
    });
    const item = native.items.data.find(
      (item) => item.id === subscription.subscriptionItemId,
    );
    if (
      native.id !== subscription.subscriptionId ||
      native.livemode !== record.scope.livemode ||
      native.customer_account !== record.scope.customerAccount ||
      customerId(native.customer) !== record.binding.stripeCustomerId ||
      native.status !== "active" ||
      native.items.has_more ||
      !item ||
      item.price.id !== record.binding.stripePriceId ||
      item.current_period_start !== subscription.period.start ||
      item.current_period_end !== subscription.period.end ||
      native.billing_thresholds
    )
      throw new Error("Original native correction period mismatch");
    const invoice = await finalizedInvoice(
      stripe,
      record,
      subscription.subscriptionId,
      saved.outbox.receipt.created,
    );
    if (invoice.held)
      return save({
        status: "held",
        reason: "native_invoice_history_incomplete",
      });
    if (invoice.invoiceId)
      return save({
        status: "invoice_adjustment_required",
        reason: "native_invoice_finalized",
        invoiceId: invoice.invoiceId,
      });
    const current = await read();
    const sendAt = Date.now() / 1000;
    if (
      current.attempt !== claimed.attempt ||
      [
        "confirmed",
        "unsupported",
        "provider_accepted",
        "invoice_adjustment_required",
      ].includes(current.state) ||
      (current.leaseUntil ?? 0) <= sendAt + 60
    )
      return correctionView(current);
    if (sendAt + 15 >= subscription.period.end - 60)
      return save({
        status: "invoice_adjustment_required",
        reason: "billing_period_closed",
      });
    if (
      sendAt - saved.outbox.receipt.created >= 23 * 3600 ||
      sendAt - (current.attemptedAt ?? current.firstAttemptAt) >= 23 * 3600
    )
      return save({
        status: "invoice_adjustment_required",
        reason: "native_cancellation_expired",
      });
    writing = true;
    const response = await stripe.billing.meterEventAdjustments.create(
      {
        event_name: record.binding.eventName,
        type: "cancel",
        cancel: { identifier: saved.outbox.providerIdentifier },
      },
      { idempotencyKey: `bs_usage_correction_${row.key}` },
    );
    if (
      response.object !== "billing.meter_event_adjustment" ||
      response.type !== "cancel" ||
      response.event_name !== record.binding.eventName ||
      response.cancel?.identifier !== saved.outbox.providerIdentifier ||
      response.livemode !== record.scope.livemode ||
      !["pending", "complete"].includes(response.status)
    )
      throw new Error("Native correction response mismatch");
    let creditBackingVerified = record.binding.plan.model !== "prepaid";
    let billingSafe =
      response.status === "complete" &&
      Date.now() / 1000 + 15 < subscription.period.end - 60;
    let invoiceId: string | undefined;
    if (response.status === "complete") {
      const after = await finalizedInvoice(
        stripe,
        record,
        subscription.subscriptionId,
        saved.outbox.receipt.created,
      );
      invoiceId = after.invoiceId;
      billingSafe = billingSafe && !after.held && !invoiceId;
      if (record.binding.plan.model === "prepaid") {
        try {
          await verifyCreditDelivery(
            stripe,
            component,
            ctx,
            saved.event,
            record,
          );
          creditBackingVerified = true;
        } catch {
          creditBackingVerified = false;
        }
      }
    }
    outcome = {
      status: response.status as "pending" | "complete",
      eventName: response.event_name,
      identifier: response.cancel.identifier!,
      livemode: response.livemode,
      nativeAdjustmentId: null,
      creditBackingVerified,
      billingSafe,
      ...(invoiceId ? { invoiceId } : {}),
    };
  } catch {
    outcome = {
      status: "held",
      reason: writing ? "provider_outcome_unknown" : "provider_unavailable",
    };
  }
  return save(outcome);
}
