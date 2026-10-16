import type Stripe from "stripe";
import { z } from "zod";

const scopeSchema = z
  .object({
    stripeInvoiceId: z
      .string()
      .max(128)
      .regex(/^in_[A-Za-z0-9_]+$/),
    customerAccount: z
      .string()
      .max(128)
      .regex(/^acct_[A-Za-z0-9_]+$/),
    stripeSubscriptionId: z
      .string()
      .max(128)
      .regex(/^sub_[A-Za-z0-9_]+$/),
  })
  .strict();
const optionsSchema = scopeSchema
  .extend({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(2048).nullable().optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: scopeSchema,
    after: z
      .string()
      .max(128)
      .regex(/^inpay_[A-Za-z0-9_]+$/),
  })
  .strict();
export type InvoicePaymentPageOptions = z.input<typeof optionsSchema>;
export type ProviderInvoicePaymentPage = {
  scope: {
    stripeInvoiceId: string;
    customerAccount: string;
    stripeSubscriptionId: string;
  };
  page: {
    invoicePayment: Stripe.InvoicePayment;
    paymentIntentId: string | null;
    referenceStatus: "payment_intent" | "unsupported" | "unavailable";
  }[];
  hasMore: boolean;
  continueCursor: string | null;
};
/** Bind a continuation to the verified invoice, buyer and subscription selectors. */
function encodeCursor(scope: z.infer<typeof scopeSchema>, after: string) {
  return btoa(JSON.stringify({ version: 1, scope, after }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
/** Reject malformed continuations and accidental cross-scope reuse before provider reads. */
function decodeCursor(cursor: string, scope: z.infer<typeof scopeSchema>) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = cursorSchema.parse(
      JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (
      JSON.stringify(value.scope) !== JSON.stringify(scope) ||
      encodeCursor(value.scope, value.after) !== cursor
    )
      throw new Error();
    return value.after;
  } catch {
    throw new Error("Invalid invoice payment page cursor or scope");
  }
}
/** Normalize provider references without inferring missing identifiers. */
function referenceId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}
/** Keep financial evidence exact; reject units that JavaScript cannot safely represent. */
function assertRepresentableUnits(row: Stripe.InvoicePayment) {
  const amounts = [
    row.amount_requested,
    ...(row.amount_paid === null ? [] : [row.amount_paid]),
  ];
  if (
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    !/^[a-z]{3}$/.test(row.currency)
  ) {
    throw new Error("Invalid provider invoice payment units or currency");
  }
}
/** Retain unsupported rows while distinguishing canonical and unavailable references. */
function paymentReference(
  invoicePayment: Stripe.InvoicePayment,
): ProviderInvoicePaymentPage["page"][number] {
  assertRepresentableUnits(invoicePayment);
  const type = invoicePayment.payment.type;
  const id =
    type === "payment_intent"
      ? referenceId(invoicePayment.payment.payment_intent)
      : undefined;
  const paymentIntentId = id && /^pi_[A-Za-z0-9_]+$/.test(id) ? id : null;
  return {
    invoicePayment,
    paymentIntentId,
    referenceStatus:
      type !== "payment_intent"
        ? "unsupported"
        : paymentIntentId
          ? "payment_intent"
          : "unavailable",
  };
}

/** Canonical provider references only. The host authorizes scope and separately verifies refund eligibility. */
export async function getInvoicePaymentPageFromStripe(
  stripe: Stripe,
  input: InvoicePaymentPageOptions,
): Promise<ProviderInvoicePaymentPage> {
  const { limit, cursor, ...scope } = optionsSchema.parse(input);
  const after = cursor ? decodeCursor(cursor, scope) : undefined;
  const invoice = await stripe.invoices.retrieve(scope.stripeInvoiceId);
  const parent = invoice.parent;
  if (
    invoice.id !== scope.stripeInvoiceId ||
    invoice.customer_account !== scope.customerAccount ||
    parent?.type !== "subscription_details" ||
    referenceId(parent.subscription_details?.subscription) !==
      scope.stripeSubscriptionId
  ) {
    throw new Error(
      "Invalid provider invoice payment buyer or subscription scope",
    );
  }
  const response = await stripe.invoicePayments.list({
    invoice: scope.stripeInvoiceId,
    limit,
    ...(after ? { starting_after: after } : {}),
  });
  if (
    response.data.length > limit ||
    new Set(response.data.map((row) => row.id)).size !== response.data.length ||
    response.data.some(
      (row) =>
        row.id === after ||
        referenceId(row.invoice) !== scope.stripeInvoiceId ||
        !/^inpay_[A-Za-z0-9_]+$/.test(row.id),
    )
  ) {
    throw new Error(
      "Invalid provider invoice payment page scope or continuation",
    );
  }
  const last = response.data[response.data.length - 1]?.id;
  if (response.has_more && (!last || last === after))
    throw new Error(
      "Provider invoice payment page has no advancing continuation",
    );
  return {
    scope,
    page: response.data.map(paymentReference),
    hasMore: response.has_more,
    continueCursor: response.has_more ? encodeCursor(scope, last!) : null,
  };
}
