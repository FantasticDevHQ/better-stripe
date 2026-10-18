import type Stripe from "stripe";
import type {
  FinancialOutcome,
  FinancialUnavailable,
} from "../financialOutcomes/contracts.js";
import {
  paymentSourceOptions,
  type VerifiedPaymentSource,
  type VerifiedPaymentSourceOptions,
} from "./contracts.js";
import { completeHistory } from "./history.js";
import { saleAmountFailure } from "./economics.js";
import { singleInvoiceFunding } from "./funding.js";

const reject = (
  reason: Extract<FinancialUnavailable, { status: "rejected" }>["reason"],
): FinancialUnavailable => ({ status: "rejected", reason, retryable: false });
const identity = (): FinancialUnavailable => ({
  status: "conflict",
  reason: "identity_changed",
  retryable: false,
});
const incomplete = (): FinancialUnavailable => ({
  status: "unknown",
  reason: "history_incomplete",
  retryable: false,
});
class SourceUnavailable extends Error {
  constructor(readonly outcome: FinancialUnavailable) {
    super(outcome.reason);
  }
}
function requireSource(
  condition: unknown,
  outcome: FinancialUnavailable,
): asserts condition {
  if (!condition) throw new SourceUnavailable(outcome);
}
const objectId = (value: string | { id: string } | null | undefined) => {
  const candidate = typeof value === "string" ? value : value?.id;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
};
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Read-only provenance. Current subscription items and application metadata never prove original price/funding. */
export async function resolveVerifiedPaymentSource(
  stripe: Stripe,
  input: VerifiedPaymentSourceOptions,
  eligibility?: {
    requirePayable: true;
    customerId: string;
    invoiceLine?: {
      id: string;
      subscriptionItemId: string;
      period: { start: number; end: number };
    };
  },
): Promise<FinancialOutcome<VerifiedPaymentSource>> {
  const parsed = paymentSourceOptions.safeParse(input);
  if (!parsed.success) return reject("invalid_scope");
  const opts = parsed.data;
  const requestOptions = opts.stripeAccountId
    ? { stripeAccount: opts.stripeAccountId }
    : undefined;
  try {
    const payment = await stripe.paymentIntents.retrieve(
      opts.paymentIntentId,
      { expand: ["latest_charge.balance_transaction"] },
      requestOptions,
    );
    requireSource(
      payment.object === "payment_intent" &&
        payment.id === opts.paymentIntentId,
      identity(),
    );
    if (payment.status === "processing")
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    if (payment.status !== "succeeded") return reject("payment_not_payable");
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    requireSource(
      charge.object === "charge" &&
        typeof charge.id === "string" &&
        !!charge.id &&
        objectId(charge.payment_intent) === payment.id,
      identity(),
    );
    requireSource(
      payment.currency === opts.currency,
      reject("currency_mismatch"),
    );
    requireSource(
      integer(payment.amount_received) &&
        payment.amount_received === opts.gross &&
        payment.amount === opts.gross,
      reject("unsupported_source"),
    );
    requireSource(
      charge.paid &&
        charge.captured &&
        charge.status === "succeeded" &&
        charge.amount_captured === opts.gross,
      reject("unsupported_source"),
    );
    requireSource(
      typeof payment.livemode === "boolean" &&
        charge.livemode === payment.livemode,
      identity(),
    );
    requireSource(
      typeof payment.customer_account === "string" &&
        !!payment.customer_account,
      reject("unsupported_source"),
    );
    if (opts.customerAccountId)
      requireSource(
        payment.customer_account === opts.customerAccountId,
        identity(),
      );
    const customerAccountId = payment.customer_account!;
    if (eligibility) {
      requireSource(
        charge.amount_refunded === 0 &&
          charge.disputed === false &&
          charge.refunded === false,
        reject("payment_not_payable"),
      );
      requireSource(
        objectId(payment.customer) === eligibility.customerId &&
          objectId(charge.customer) === eligibility.customerId,
        identity(),
      );
      requireSource(
        !payment.transfer_data &&
          !payment.on_behalf_of &&
          !payment.application_fee_amount &&
          !charge.transfer,
        reject("unsupported_source"),
      );
    }
    const balanceRef = charge.balance_transaction;
    if (!balanceRef)
      return { status: "not_ready", reason: "fee_pending", retryable: true };
    const balance =
      typeof balanceRef === "string"
        ? await stripe.balanceTransactions.retrieve(
            balanceRef,
            {},
            requestOptions,
          )
        : balanceRef;
    if (typeof balanceRef === "string")
      requireSource(balance.id === balanceRef, identity());
    requireSource(
      balance.object === "balance_transaction" &&
        typeof balance.id === "string" &&
        !!balance.id &&
        objectId(balance.source) === charge.id,
      identity(),
    );
    const amountFailure = saleAmountFailure(payment, charge, balance);
    requireSource(amountFailure !== "currency", reject("currency_mismatch"));
    requireSource(
      !amountFailure &&
        integer(balance.amount) &&
        integer(balance.net) &&
        balance.amount === opts.gross &&
        balance.amount - balance.fee === balance.net,
      reject("unsupported_source"),
    );
    const read = <T extends { id: string }>(
      fetch: (
        cursor: string | undefined,
        limit: number,
      ) => Promise<Stripe.ApiList<T>>,
    ) => completeHistory(fetch, opts.maxHistoryPages, opts.maxHistoryItems);
    const inverse = await read((cursor, limit) =>
      stripe.invoicePayments.list(
        {
          payment: { type: "payment_intent", payment_intent: payment.id },
          limit,
          ...(cursor ? { starting_after: cursor } : {}),
        },
        requestOptions,
      ),
    );
    if (inverse.status !== "complete") return inverse;
    for (const row of inverse.data) {
      requireSource(
        row.object === "invoice_payment" &&
          ["paid", "open", "canceled"].includes(row.status),
        incomplete(),
      );
      requireSource(
        row.payment.type === "payment_intent" &&
          objectId(row.payment.payment_intent) === payment.id &&
          row.livemode === payment.livemode,
        identity(),
      );
      requireSource(
        row.currency === opts.currency,
        reject("currency_mismatch"),
      );
    }
    const original = singleInvoiceFunding(inverse.data, opts.gross);
    requireSource(original, reject("unsupported_source"));
    const invoiceId = objectId(original!.invoice);
    requireSource(invoiceId, identity());
    if (opts.invoiceId) requireSource(invoiceId === opts.invoiceId, identity());
    const invoice = await stripe.invoices.retrieve(
      invoiceId!,
      {},
      requestOptions,
    );
    requireSource(
      invoice.object === "invoice" &&
        invoice.id === invoiceId &&
        invoice.customer_account === customerAccountId &&
        invoice.livemode === payment.livemode,
      identity(),
    );
    if (eligibility)
      requireSource(
        objectId(invoice.customer) === eligibility.customerId,
        identity(),
      );
    requireSource(
      invoice.currency === opts.currency,
      reject("currency_mismatch"),
    );
    if (invoice.status !== "paid")
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    requireSource(
      [invoice.amount_paid, invoice.amount_due, invoice.total].every(
        (value) => integer(value) && value === opts.gross,
      ) &&
        invoice.amount_remaining === 0 &&
        invoice.amount_overpaid === 0,
      reject("unsupported_source"),
    );
    const funding = await read((cursor, limit) =>
      stripe.invoicePayments.list(
        {
          invoice: invoice.id,
          limit,
          ...(cursor ? { starting_after: cursor } : {}),
        },
        requestOptions,
      ),
    );
    if (funding.status !== "complete") return funding;
    for (const row of funding.data) {
      requireSource(
        row.object === "invoice_payment" &&
          ["paid", "open", "canceled"].includes(row.status),
        incomplete(),
      );
      requireSource(
        objectId(row.invoice) === invoice.id &&
          row.livemode === payment.livemode,
        identity(),
      );
      requireSource(
        row.currency === opts.currency,
        reject("currency_mismatch"),
      );
    }
    const funded = singleInvoiceFunding(funding.data, invoice.amount_paid);
    requireSource(funded, reject("unsupported_source"));
    requireSource(
      funded!.id === original!.id &&
        objectId(funded!.payment.payment_intent) === payment.id,
      identity(),
    );
    requireSource(
      original!.amount_requested === opts.gross &&
        funded!.amount_requested === opts.gross,
      reject("unsupported_source"),
    );
    const subscriptionId = objectId(
      invoice.parent?.subscription_details?.subscription,
    );
    if (opts.subscriptionId)
      requireSource(subscriptionId === opts.subscriptionId, identity());
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId,
        {},
        requestOptions,
      );
      if (eligibility)
        requireSource(
          objectId(subscription.customer) === eligibility.customerId,
          identity(),
        );
      requireSource(
        subscription.object === "subscription" &&
          subscription.id === subscriptionId &&
          subscription.customer_account === customerAccountId &&
          subscription.livemode === payment.livemode,
        identity(),
      );
    }
    const lines = await read((cursor, limit) =>
      stripe.invoices.listLineItems(
        invoice.id,
        { limit, ...(cursor ? { starting_after: cursor } : {}) },
        requestOptions,
      ),
    );
    if (lines.status !== "complete") return lines;
    requireSource(lines.data.length === 1, reject("unsupported_source"));
    const line = lines.data[0]!;
    requireSource(
      line.object === "line_item" &&
        line.invoice === invoice.id &&
        line.livemode === payment.livemode,
      identity(),
    );
    requireSource(line.currency === opts.currency, reject("currency_mismatch"));
    requireSource(
      integer(line.amount) &&
        line.amount > 0 &&
        (line.quantity_decimal != null
          ? /^\d{1,30}(\.\d{1,12})?$/.test(line.quantity_decimal.toString()) &&
            /[1-9]/.test(line.quantity_decimal.toString())
          : Number.isSafeInteger(line.quantity) && line.quantity! > 0),
      reject("unsupported_source"),
    );
    const parent = line.parent;
    if (eligibility?.invoiceLine) {
      const expected = eligibility.invoiceLine;
      requireSource(
        line.id === expected.id &&
          line.parent?.subscription_item_details?.subscription_item ===
            expected.subscriptionItemId &&
          line.period.start === expected.period.start &&
          line.period.end === expected.period.end,
        identity(),
      );
    }
    const lineSubscription =
      parent?.subscription_item_details?.subscription ??
      parent?.invoice_item_details?.subscription ??
      undefined;
    requireSource(lineSubscription === subscriptionId, identity());
    requireSource(
      !parent?.subscription_item_details?.proration &&
        !parent?.invoice_item_details?.proration,
      reject("unsupported_source"),
    );
    const price = line.pricing?.price_details;
    const priceId = objectId(price?.price);
    const productId = objectId(price?.product);
    requireSource(
      line.pricing?.type === "price_details" && priceId && productId,
      reject("unsupported_source"),
    );
    return {
      status: "ready",
      value: {
        paymentIntentId: payment.id,
        chargeId: charge.id,
        invoiceId: invoice.id,
        invoicePaymentId: funded!.id,
        ...(subscriptionId ? { subscriptionId } : {}),
        customerAccountId,
        ...(opts.stripeAccountId
          ? { stripeAccountId: opts.stripeAccountId }
          : {}),
        stripePriceId: priceId,
        stripeProductId: productId,
        gross: opts.gross,
        processingFee: balance.fee,
        currency: opts.currency,
        livemode: payment.livemode,
      },
    };
  } catch (error) {
    if (error instanceof SourceUnavailable) return error.outcome;
    return {
      status: "unknown",
      reason: "provider_outcome_unknown",
      retryable: false,
    };
  }
}
