import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const apiVersion = "2026-09-30.endive";

// Development-only provider proof. Default mode uses a promotional grant.
// Explicit test-payment mode purchases credits with a test card and refunds it.
export async function runMeteringSandbox({
  apiKey,
  runId = randomUUID(),
  verifyPayments = false,
  finalizeInvoices = false,
  wait = () => setTimeout(5_000),
  createClient = (key) => new Stripe(key, { apiVersion, maxNetworkRetries: 0 }),
}) {
  if (typeof apiKey !== "string" || !/^sk_test_\S+$/.test(apiKey))
    throw new Error("A Stripe test-mode secret key is required");
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(runId))
    throw new Error("Invalid run identity");
  const stripe = createClient(apiKey);
  const cleanup = [];
  const evidence = {
    apiVersion,
    observedAt: new Date().toISOString(),
    models: [],
    cleanup: [],
  };
  const options = (step) => ({
    idempotencyKey: `bs-metering-${runId}-${step}`,
  });
  const testOnly = (object) => {
    if (object.livemode !== false) throw new Error("Expected test-mode object");
    return object;
  };
  let step = "account";
  let clock;
  const lifecycle = [];
  try {
    if (finalizeInvoices) {
      step = "test-clock";
      clock = await stripe.testHelpers.testClocks.create(
        {
          frozen_time: Math.floor(Date.now() / 60000) * 60 - 60,
          name: `BetterStripe usage ${runId}`,
        },
        options("clock"),
      );
      cleanup.push([
        "test-clock",
        () => stripe.testHelpers.testClocks.del(clock.id),
      ]);
    }
    step = "account";
    const account = testOnly(
      await stripe.v2.core.accounts.create(
        {
          display_name: `BetterStripe metering feasibility ${runId}`,
          contact_email: `metering-${runId}@example.invalid`,
          configuration: { customer: clock ? { test_clock: clock.id } : {} },
          identity: { country: "us" },
        },
        options("account"),
      ),
    );
    step = "payer-mapping";
    const customer = testOnly(await stripe.customers.retrieve(account.id));
    if (
      customer.customer_account !== account.id ||
      !customer.id.startsWith("cus_")
    )
      throw new Error("Unverified payer mapping");
    evidence.payerMappingVerified = true;
    for (const model of ["pay_as_you_go", "included_overage", "prepaid"]) {
      step = `${model}:meter`;
      const eventName = `bs_probe_${runId.replaceAll("-", "_")}_${model}`;
      const meter = testOnly(
        await stripe.billing.meters.create(
          {
            display_name: `Feasibility ${model}`,
            event_name: eventName,
            default_aggregation: { formula: "sum" },
            customer_mapping: {
              type: "by_id",
              event_payload_key: "stripe_customer_id",
            },
            value_settings: { event_payload_key: "value" },
          },
          options(`${model}-meter`),
        ),
      );
      cleanup.push(["meter", () => stripe.billing.meters.deactivate(meter.id)]);
      step = `${model}:product`;
      const product = testOnly(
        await stripe.products.create(
          { name: `Feasibility ${model} ${runId}` },
          options(`${model}-product`),
        ),
      );
      cleanup.push([
        "product",
        () => stripe.products.update(product.id, { active: false }),
      ]);
      step = `${model}:price`;
      const price = testOnly(
        await stripe.prices.create(
          {
            product: product.id,
            currency: "usd",
            recurring: {
              interval: "month",
              usage_type: "metered",
              meter: meter.id,
            },
            ...(model === "included_overage"
              ? {
                  billing_scheme: "tiered",
                  tiers_mode: "graduated",
                  tiers: [
                    { up_to: 10, unit_amount: 0 },
                    { up_to: "inf", unit_amount: 2 },
                  ],
                }
              : { unit_amount: 2 }),
          },
          options(`${model}-price`),
        ),
      );
      cleanup.push([
        "price",
        () => stripe.prices.update(price.id, { active: false }),
      ]);
      step = `${model}:subscription`;
      const subscription = testOnly(
        await stripe.subscriptions.create(
          {
            customer_account: account.id,
            ...(finalizeInvoices ? { billing_mode: { type: "flexible" } } : {}),
            items: [{ price: price.id }],
            collection_method: "send_invoice",
            days_until_due: 30,
          },
          options(`${model}-subscription`),
        ),
      );
      cleanup.push([
        "subscription",
        () =>
          stripe.subscriptions.cancel(subscription.id, {
            invoice_now: false,
            prorate: false,
          }),
      ]);
      if (
        subscription.customer_account !== account.id ||
        subscription.customer !== customer.id
      )
        throw new Error("Unverified subscription payer");
      if (finalizeInvoices) {
        const periodEnd = subscription.items?.data?.[0]?.current_period_end;
        if (!Number.isSafeInteger(periodEnd))
          throw new Error("Unverified test-clock period");
        lifecycle.push({
          model,
          id: subscription.id,
          periodEnd,
          meterId: meter.id,
          timestamp: clock.frozen_time,
        });
      }
      let paymentVerified = false;
      if (model === "prepaid") {
        let payment;
        if (verifyPayments) {
          step = `${model}:payment`;
          payment = testOnly(
            await stripe.paymentIntents.create(
              {
                amount: 100,
                currency: "usd",
                customer_account: account.id,
                payment_method: "pm_card_visa",
                allowed_payment_method_types: ["card"],
                confirm: true,
              },
              options("prepaid-payment"),
            ),
          );
          if (payment.status === "succeeded")
            cleanup.push([
              "test-payment-refund",
              () =>
                stripe.refunds.create(
                  { payment_intent: payment.id },
                  options("prepaid-refund"),
                ),
            ]);
          if (
            payment.status !== "succeeded" ||
            payment.customer_account !== account.id ||
            payment.amount_received !== 100 ||
            payment.currency !== "usd"
          )
            throw new Error("Unverified prepaid payment");
          paymentVerified = true;
        }
        step = `${model}:credit-grant`;
        const credit = testOnly(
          await stripe.billing.creditGrants.create(
            {
              customer_account: account.id,
              category: paymentVerified ? "paid" : "promotional",
              ...(paymentVerified
                ? { metadata: { feasibilityPaymentIntent: payment.id } }
                : {}),
              amount: {
                type: "monetary",
                monetary: { currency: "usd", value: 100 },
              },
              applicability_config: { scope: { prices: [{ id: price.id }] } },
            },
            options("prepaid-credit"),
          ),
        );
        cleanup.push([
          "credit",
          () => stripe.billing.creditGrants.expire(credit.id),
        ]);
        if (credit.customer_account !== account.id)
          throw new Error("Unverified credit payer");
      }
      step = `${model}:event`;
      const timestamp = clock?.frozen_time ?? Math.floor(Date.now() / 1000);
      const event = {
        event_name: eventName,
        identifier: `bs-${runId}-${model}`,
        payload: { stripe_customer_id: customer.id, value: "15" },
        timestamp,
      };
      for (let delivery = 0; delivery < 2; delivery++) {
        testOnly(
          await stripe.billing.meterEvents.create(
            event,
            options(`${model}-event`),
          ),
        );
      }
      step = `${model}:summaries`;
      let aggregatedQuantity = 0;
      for (let attempt = 0; attempt < 12; attempt++) {
        const summaries = await stripe.billing.meters.listEventSummaries(
          meter.id,
          {
            customer: customer.id,
            start_time: Math.floor(timestamp / 60) * 60,
            end_time: Math.floor(timestamp / 60) * 60 + 60,
          },
        );
        aggregatedQuantity = summaries.data.reduce(
          (sum, row) => sum + row.aggregated_value,
          0,
        );
        if (aggregatedQuantity > 0) break;
        if (attempt < 11) await wait();
      }
      step = `${model}:preview`;
      const invoice = testOnly(
        await stripe.invoices.createPreview({
          customer_account: account.id,
          subscription: subscription.id,
        }),
      );
      evidence.models.push({
        model,
        catalogCreated: true,
        eventAccepted: true,
        aggregatedQuantity,
        aggregationVerified: aggregatedQuantity === 15,
        duplicateRetryVerified: aggregatedQuantity === 15,
        invoiceIdentityVerified: invoice.customer_account === account.id,
        previewTotal: invoice.total,
        currency: invoice.currency,
        paymentVerified,
        creditPurchaseVerified: model === "prepaid" && paymentVerified,
        invoiceFinalizationVerified: false,
      });
    }
    if (finalizeInvoices) {
      step = "test-clock:ingestion";
      for (
        let attempt = 0;
        attempt < 24 &&
        evidence.models.some((model) => !model.aggregationVerified);
        attempt++
      ) {
        for (const pending of lifecycle) {
          const row = evidence.models.find(
            (model) => model.model === pending.model,
          );
          if (row.aggregationVerified) continue;
          const summaries = await stripe.billing.meters.listEventSummaries(
            pending.meterId,
            {
              customer: customer.id,
              start_time: Math.floor(pending.timestamp / 60) * 60,
              end_time: Math.floor(pending.timestamp / 60) * 60 + 60,
            },
          );
          const quantity = summaries.data.reduce(
            (sum, summary) => sum + summary.aggregated_value,
            0,
          );
          Object.assign(row, {
            aggregatedQuantity: quantity,
            aggregationVerified: quantity === 15,
            duplicateRetryVerified: quantity === 15,
          });
        }
        if (evidence.models.every((model) => model.aggregationVerified)) break;
        if (attempt < 23) await wait();
      }
      const ingestedBeforeAdvance = evidence.models.every(
        (model) => model.aggregationVerified,
      );
      if (!ingestedBeforeAdvance)
        throw new Error("Usage ingestion not yet verified");
      const advanceTo =
        Math.max(...lifecycle.map((sub) => sub.periodEnd)) + 7200;
      step = "test-clock:advance";
      await stripe.testHelpers.testClocks.advance(
        clock.id,
        { frozen_time: advanceTo },
        options("clock-advance"),
      );
      let ready = false;
      for (let attempt = 0; attempt < 24; attempt++) {
        const state = await stripe.testHelpers.testClocks.retrieve(clock.id);
        if (state.status === "ready") {
          ready = true;
          break;
        }
        if (attempt < 23) await wait();
      }
      if (!ready) throw new Error("Test clock not ready");
      evidence.testClock = {
        ingestedBeforeAdvance,
        advanced: true,
        ready: true,
        advancementDoesNotProveIngestion: true,
      };
      for (const sub of lifecycle) {
        step = `${sub.model}:final-invoice`;
        const page = await stripe.invoices.list({
          customer_account: account.id,
          subscription: sub.id,
          limit: 100,
        });
        if (page.has_more) throw new Error("Incomplete native invoice history");
        let invoice = page.data.find(
          (invoice) =>
            invoice.billing_reason === "subscription_cycle" &&
            invoice.period_end === sub.periodEnd,
        );
        if (!invoice) throw new Error("Period-end invoice unavailable");
        if (invoice.status === "draft")
          invoice = await stripe.invoices.finalizeInvoice(
            invoice.id,
            {},
            options(`${sub.model}-finalize`),
          );
        const invoiceSubscription =
          invoice.parent?.subscription_details?.subscription;
        const nativeId =
          typeof invoiceSubscription === "string"
            ? invoiceSubscription
            : invoiceSubscription?.id;
        const finalizationVerified =
          invoice.livemode === false &&
          invoice.customer_account === account.id &&
          (typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id) === customer.id &&
          nativeId === sub.id &&
          invoice.status !== "draft" &&
          Number.isSafeInteger(invoice.status_transitions?.finalized_at) &&
          !invoice.lines.has_more;
        const expected = {
          pay_as_you_go: 30,
          included_overage: 10,
          prepaid: 0,
        }[sub.model];
        const row = evidence.models.find((model) => model.model === sub.model);
        Object.assign(row, {
          invoiceFinalizationVerified: finalizationVerified,
          finalizedTotal: invoice.total,
          finalizedCurrency: invoice.currency,
          finalizedAmountVerified:
            finalizationVerified &&
            invoice.total === expected &&
            invoice.currency === "usd",
          finalizedPaymentEvidence: "not_resolved",
        });
      }
    }
  } catch (error) {
    // A fixed step and numeric status are enough to diagnose access/shape issues.
    // Provider error messages may contain credentials or customer data.
    const status = Number.isInteger(error?.statusCode)
      ? ` HTTP ${error.statusCode}`
      : "";
    const classification = [error?.code, error?.param]
      .map((value) =>
        typeof value === "string" && /^[a-z_][a-z_.[\]0-9]{0,80}$/.test(value)
          ? value
          : "unspecified",
      )
      .join(":");
    throw Object.assign(
      new Error(
        `Metering sandbox failed at ${step}${status} ${classification}; payer mapping and later steps may be unverified`,
      ),
      { evidence },
    );
  } finally {
    for (const [kind, dispose] of cleanup.reverse()) {
      try {
        await dispose();
        evidence.cleanup.push({ kind, success: true });
      } catch {
        evidence.cleanup.push({ kind, success: false });
      }
    }
  }
  return evidence;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await runMeteringSandbox({
          apiKey: process.env.STRIPE_SECRET_KEY,
          verifyPayments: process.argv.includes("--verify-test-payment"),
          finalizeInvoices: process.argv.includes("--finalize-test-invoices"),
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    if (error.evidence) console.log(JSON.stringify(error.evidence, null, 2));
    process.exitCode = 1;
  }
}
