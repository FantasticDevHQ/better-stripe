import { getProcessingCostContext } from "./settlement/processingCosts.js";
import type Stripe from "stripe";
import type { RecoveryGroup, RecoveryScope } from "./costRecovery.js";
export type RecoveryInvoiceOptions = RecoveryScope & { groupKey: string };
const marker = "bsRecoveryGroup";
const id = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;

type InvoiceReceipt = {
  group: RecoveryGroup;
  invoiceItemId: string;
  invoiceStatus: Stripe.Invoice["status"];
};
type BindInvoiceItem = (invoiceItemId: string) => Promise<RecoveryGroup>;

/** Attachment always produces an item; reconciliation can release an unbound void invoice. */
export function attachRecoveryInvoice(
  stripe: Stripe,
  group: RecoveryGroup | null,
  opts: RecoveryInvoiceOptions,
  bind: BindInvoiceItem,
  create?: true,
): Promise<InvoiceReceipt>;
export function attachRecoveryInvoice(
  stripe: Stripe,
  group: RecoveryGroup | null,
  opts: RecoveryInvoiceOptions,
  bind: BindInvoiceItem,
  create: false,
): Promise<
  | InvoiceReceipt
  | (Omit<InvoiceReceipt, "invoiceItemId"> & { invoiceItemId: null })
>;

/** One immutable item per sealed group. Host serializes provider operations per group. */
export async function attachRecoveryInvoice(
  stripe: Stripe,
  group: RecoveryGroup | null,
  opts: RecoveryInvoiceOptions,
  bind: (invoiceItemId: string) => Promise<RecoveryGroup>,
  create = true,
) {
  if (
    !group ||
    group.groupKey !== opts.groupKey ||
    group.sourceKind !== "invoice" ||
    group.accountId !== opts.accountId ||
    group.scopeKey !== opts.scopeKey ||
    group.currency !== opts.currency
  )
    throw new Error(
      "Recovery invoice scope does not match the authorized group.",
    );
  if (
    group.status === "open" ||
    (create && ["released", "releasing"].includes(group.status))
  )
    throw new Error("Invoice recovery group must be sealed and active.");
  const invoice = await stripe.invoices.retrieve(group.sourceId);
  if (
    invoice.id !== group.sourceId ||
    invoice.customer_account !== group.accountId
  )
    throw new Error("Recovery invoice ownership does not match.");
  if (invoice.currency !== group.currency)
    throw new Error("Recovery invoice currency does not match.");
  let found: Stripe.InvoiceItem | undefined;
  for await (const item of stripe.invoiceItems.list({
    invoice: invoice.id,
    limit: 100,
  })) {
    if (item.metadata?.[marker] !== group._id) continue;
    if (found)
      throw new Error(
        "Duplicate recovery invoice items require reconciliation.",
      );
    if (
      id(item.invoice) !== invoice.id ||
      item.customer_account !== group.accountId ||
      item.currency !== group.currency ||
      item.amount !== group.amount ||
      item.discountable ||
      (group.invoiceItemId && group.invoiceItemId !== item.id)
    )
      throw new Error(
        "Recovery invoice item economics or identity do not match.",
      );
    found = item;
  }
  if (!found) {
    if (group.invoiceItemId)
      throw new Error(
        "Bound recovery invoice item is missing; reconcile before retrying.",
      );
    if (
      !create &&
      invoice.status === "void" &&
      ["sealed", "releasing", "released"].includes(group.status)
    )
      return { group, invoiceItemId: null, invoiceStatus: invoice.status };
    if (!create)
      throw new Error(
        "Recovery invoice item is missing; no collection can be confirmed.",
      );
    if (group.status !== "sealed")
      throw new Error(
        "New recovery items require a sealed, uncompleted group.",
      );
    if (invoice.status !== "draft")
      throw new Error("New recovery items require a draft invoice.");
    found = await stripe.invoiceItems.create(
      {
        invoice: invoice.id,
        customer_account: group.accountId,
        currency: group.currency,
        amount: group.amount,
        discountable: false,
        description: "Refund and dispute cost adjustment",
        metadata: { [marker]: group._id },
      },
      { idempotencyKey: `better-stripe:recovery:${group._id}` },
    );
  }
  const bound = group.invoiceItemId === found.id ? group : await bind(found.id);
  return {
    group: bound,
    invoiceItemId: found.id,
    invoiceStatus: invoice.status,
  };
}

/** Refuse ambiguous cash/credit or multi-payment allocations instead of inventing economics. */
export async function readInvoiceFunding(stripe: Stripe, group: RecoveryGroup) {
  const invoice = await stripe.invoices.retrieve(group.sourceId);
  if (
    invoice.customer_account !== group.accountId ||
    invoice.currency !== group.currency ||
    invoice.status !== "paid"
  )
    throw new Error(
      "Invoice funding ownership, currency or paid state does not match.",
    );
  const payments: Stripe.InvoicePayment[] = [];
  for await (const payment of stripe.invoicePayments.list({
    invoice: group.sourceId,
    limit: 100,
  })) {
    if (
      id(payment.invoice) !== group.sourceId ||
      payment.currency !== group.currency
    )
      throw new Error("Invoice payment identity or currency does not match.");
    if (payment.status === "paid") payments.push(payment);
  }
  const payment = payments[0];
  if (
    payments.length !== 1 ||
    payment?.payment.type !== "payment_intent" ||
    !payment.payment.payment_intent ||
    payment.amount_paid !== invoice.amount_paid
  )
    return {
      status: "not_ready" as const,
      reason: "invoice_funding_allocation_required" as const,
    };
  const cost = await getProcessingCostContext(stripe, {
    paymentIntentId: id(payment.payment.payment_intent)!,
  });
  if (cost.status === "not_ready") return cost;
  if (cost.currency !== group.currency || cost.gross !== invoice.amount_paid)
    return {
      status: "not_ready" as const,
      reason: "invoice_funding_allocation_required" as const,
    };
  return cost;
}
