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
  try {
    const account = testOnly(
      await stripe.v2.core.accounts.create(
        {
          display_name: `BetterStripe metering feasibility ${runId}`,
          contact_email: `metering-${runId}@example.invalid`,
          configuration: { customer: {} },
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
      const timestamp = Math.floor(Date.now() / 1000);
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
    throw new Error(
      `Metering sandbox failed at ${step}${status} ${classification}; payer mapping and later steps may be unverified`,
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
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
