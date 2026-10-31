import type {
  InvoiceEvidenceV1,
  InvoiceLineMatchV1,
} from "./evidence-v1-types.js";
import {
  reconstructConfigurationV2,
  type ProjectRenewalConfigurationV2Options,
} from "../renewalV2/index.js";
import { object, array, get, equal, type O } from "./common.js";
import {
  inspectInvoiceLinesV1,
  invoiceRecordV1,
  invoiceReferenceV1,
  InvoiceEvidenceStopV1,
} from "./evidence-invoice-lines.js";

function incomplete(): never {
  throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
}
function relation(value: unknown): asserts value {
  if (!value)
    throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
}
function material(value: unknown): asserts value {
  if (!value)
    throw new InvoiceEvidenceStopV1("invoice_material_mismatch", "conflict");
}
function closed(value: unknown, keys: string[]) {
  const data = invoiceRecordV1(value),
    actual = Object.keys(data);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !actual.includes(key))
  )
    incomplete();
  return data;
}
function invoiceId(value: unknown) {
  const id =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? null
        : invoiceRecordV1(value).id;
  if (typeof id !== "string" || !/^in_[A-Za-z0-9_]+$/.test(id)) incomplete();
  return id;
}
function status(value: unknown): InvoiceLineMatchV1["invoiceStatus"] {
  if (
    value === null ||
    value === "draft" ||
    value === "open" ||
    value === "paid" ||
    value === "uncollectible" ||
    value === "void"
  )
    return value;
  throw new InvoiceEvidenceStopV1("unsupported_profile");
}
function period(value: O, startKey: string, endKey: string) {
  const start = value[startKey],
    end = value[endKey];
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  )
    incomplete();
  return { start, end };
}
/** Exact paired Endive billing facts only. No payment or exclusive-cause proof. */
export async function inspectInvoiceEvidenceV1(
  input: unknown,
): Promise<InvoiceEvidenceV1> {
  try {
    const raw = invoiceRecordV1(input);
    const inventory = closed(raw.invoiceContext, ["original", "current"]);
    const reconstruction = await reconstructConfigurationV2(
      raw.configuration as ProjectRenewalConfigurationV2Options,
    );
    if (!reconstruction.material) incomplete();
    const { material: owned } = reconstruction;
    const expected = owned.prepared.expected;
    const originalSub = get(
      object(owned.prepared.providerSnapshot),
      "subscription",
    );
    const originalItem = object(array(get(originalSub, "items").data)[0]);
    const originalPrice = get(originalItem, "price"),
      targetPrice = object(owned.args.targetPrice);
    const knownCustomer = object(owned.args.billingCustomer),
      customerId = knownCustomer.id;
    if (typeof customerId !== "string") incomplete();
    const reads = closed(raw.reads, [
      "schedule",
      "subscription",
      "targetPrice",
      "billingCustomer",
      "coupons",
    ]);
    const sub = invoiceRecordV1(reads.subscription),
      schedule = invoiceRecordV1(reads.schedule);
    const customer = invoiceRecordV1(reads.billingCustomer);
    relation(
      sub.object === "subscription" &&
        sub.id === expected.subscriptionId &&
        sub.customer_account === expected.customerAccountId &&
        sub.livemode === expected.livemode,
    );
    relation(
      schedule.object === "subscription_schedule" &&
        schedule.id === owned.receipt.scheduleId &&
        schedule.customer_account === expected.customerAccountId &&
        schedule.livemode === expected.livemode,
    );
    relation(
      customer.object === "customer" &&
        customer.id === customerId &&
        customer.customer_account === expected.customerAccountId &&
        customer.livemode === expected.livemode,
    );
    invoiceReferenceV1(sub.customer, customerId, "customer", customer);
    invoiceReferenceV1(schedule.customer, customerId, "customer", customer);
    invoiceReferenceV1(
      sub.schedule,
      owned.receipt.scheduleId,
      "subscription_schedule",
      schedule,
    );
    invoiceReferenceV1(
      schedule.subscription,
      expected.subscriptionId,
      "subscription",
      sub,
    );
    if (schedule.status !== "active")
      throw new InvoiceEvidenceStopV1("unsupported_profile");
    const items = invoiceRecordV1(sub.items);
    if (
      items.has_more !== false ||
      !Array.isArray(items.data) ||
      items.data.length !== 1
    )
      incomplete();
    const item = invoiceRecordV1(items.data[0]);
    const observedItemId = item.id;
    if (
      item.object !== "subscription_item" ||
      typeof observedItemId !== "string" ||
      !/^si_[A-Za-z0-9_]+$/.test(observedItemId)
    )
      incomplete();
    invoiceReferenceV1(
      item.subscription,
      expected.subscriptionId,
      "subscription",
      sub,
    );
    invoiceReferenceV1(
      item.price,
      expected.targetPriceId,
      "price",
      targetPrice,
    );
    material(equal(reads.targetPrice, targetPrice));
    material(item.quantity === owned.prepared.quantity);
    const native = period(item, "current_period_start", "current_period_end");
    const phase = closed(schedule.current_phase, ["start_date", "end_date"]);
    const active = period(phase, "start_date", "end_date");
    material(active.start === expected.periodEnd && equal(active, native));
    const phases = array(schedule.phases);
    if (phases.length !== 2) incomplete();
    const targetPhase = invoiceRecordV1(phases[1]);
    material(
      targetPhase.start_date === native.start &&
        targetPhase.end_date === native.end,
    );
    const originalNative = {
      start: expected.periodStart,
      end: expected.periodEnd,
    };
    const originalInvoiceId = invoiceId(originalSub.latest_invoice),
      currentInvoiceId = invoiceId(sub.latest_invoice);
    const examine = (role: "original" | "current") => {
      const row = closed(inventory[role], ["invoice", "linePages"]);
      const invoice = invoiceRecordV1(row.invoice);
      const id = role === "original" ? originalInvoiceId : currentInvoiceId;
      if (invoice.object !== "invoice" || typeof invoice.id !== "string")
        incomplete();
      if (
        typeof invoice.customer_account !== "string" ||
        typeof invoice.livemode !== "boolean"
      )
        incomplete();
      relation(
        invoice.id === id &&
          invoice.customer_account === expected.customerAccountId &&
          invoice.livemode === expected.livemode,
      );
      invoiceReferenceV1(
        invoice.customer,
        customerId,
        "customer",
        role === "original" ? knownCustomer : customer,
      );
      invoiceReferenceV1(
        role === "original" ? originalSub.latest_invoice : sub.latest_invoice,
        id,
        "invoice",
        invoice,
      );
      const parent = invoiceRecordV1(invoice.parent);
      if (parent.type !== "subscription_details") incomplete();
      const details = invoiceRecordV1(parent.subscription_details);
      invoiceReferenceV1(
        details.subscription,
        expected.subscriptionId,
        "subscription",
        role === "original" ? originalSub : sub,
      );
      if (
        role === "original"
          ? invoice.billing_reason !== "subscription_create" &&
            invoice.billing_reason !== "subscription_cycle"
          : invoice.billing_reason !== "subscription_cycle"
      )
        throw new InvoiceEvidenceStopV1("unsupported_invoice_reason");
      const price = role === "original" ? originalPrice : targetPrice;
      if (typeof invoice.currency !== "string") incomplete();
      material(invoice.currency === price.currency);
      if (invoice.status === undefined) incomplete();
      return inspectInvoiceLinesV1(row.linePages, {
        invoiceId: id,
        invoiceStatus: status(invoice.status),
        subscriptionId: expected.subscriptionId,
        subscription: role === "original" ? originalSub : sub,
        itemId: role === "original" ? expected.itemId : observedItemId,
        period: role === "original" ? originalNative : native,
        price,
        productId:
          role === "original"
            ? expected.currentProductId
            : expected.targetProductId,
        quantity: owned.prepared.quantity,
        livemode: expected.livemode,
      });
    };
    const original = examine("original"),
      current = examine("current");
    return {
      predicate: "invoice_lines_correlated",
      original,
      current,
      reason: null,
    };
  } catch (error) {
    return {
      predicate:
        error instanceof InvoiceEvidenceStopV1 ? error.predicate : "unknown",
      original: null,
      current: null,
      reason:
        error instanceof InvoiceEvidenceStopV1
          ? error.reason
          : "incomplete_invoice_lines",
    };
  }
}
