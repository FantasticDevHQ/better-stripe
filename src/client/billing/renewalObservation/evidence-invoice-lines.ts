import type {
  InvoiceLineMatchV1,
  Reason,
  Period,
} from "./evidence-v1-types.js";
import { equal, type O } from "./common.js";

export class InvoiceEvidenceStopV1 extends Error {
  constructor(
    readonly reason: Reason,
    readonly predicate: "unknown" | "conflict" = "unknown",
  ) {
    super(reason);
  }
}
export function invoiceRecordV1(value: unknown): O {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  return value as O;
}
/** Expanded references need their complete separately correlated counterpart. */
export function invoiceReferenceV1(
  raw: unknown,
  expected: string,
  kind: string,
  known?: O,
): string {
  if (raw === null || raw === undefined)
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  if (typeof raw === "string") {
    if (raw !== expected)
      throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
    return raw;
  }
  const expanded = invoiceRecordV1(raw);
  if (
    expanded.id !== expected ||
    expanded.object !== kind ||
    expanded.deleted === true
  )
    throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
  for (const field of ["livemode", "customer_account"])
    if (
      Object.prototype.hasOwnProperty.call(expanded, field) &&
      (!known || expanded[field] !== known[field])
    )
      throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
  const minimal = Object.keys(expanded).every((key) =>
    ["id", "object", "deleted", "livemode", "customer_account"].includes(key),
  );
  if (!minimal && (!known || !equal(expanded, known)))
    throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
  return expected;
}
function decimal(raw: unknown) {
  if (typeof raw !== "string" || !/^\d+(?:\.\d{1,12})?$/.test(raw))
    throw new InvoiceEvidenceStopV1("unsupported_profile");
  const [integer, fraction = ""] = raw.split(".");
  return {
    coefficient: BigInt(integer + fraction),
    scale: fraction.length,
    raw,
  };
}
export function sameInvoiceDecimalV1(left: unknown, right: unknown): boolean {
  const a = decimal(left),
    b = decimal(right),
    scale = Math.max(a.scale, b.scale);
  return (
    a.coefficient * 10n ** BigInt(scale - a.scale) ===
    b.coefficient * 10n ** BigInt(scale - b.scale)
  );
}
type LineContext = {
  invoiceId: string;
  invoiceStatus: InvoiceLineMatchV1["invoiceStatus"];
  subscriptionId: string;
  subscription: O;
  itemId: string;
  period: Period;
  price: O;
  productId: string;
  quantity: number;
  livemode: boolean;
};
function material(condition: unknown): asserts condition {
  if (!condition)
    throw new InvoiceEvidenceStopV1("invoice_material_mismatch", "conflict");
}
function oneLine(
  raw: unknown,
  context: LineContext,
): InvoiceLineMatchV1 | null {
  const line = invoiceRecordV1(raw);
  if (
    line.object !== "line_item" ||
    typeof line.id !== "string" ||
    !/^il_[A-Za-z0-9_]+$/.test(line.id)
  )
    throw new InvoiceEvidenceStopV1("unsupported_profile");
  invoiceReferenceV1(line.invoice, context.invoiceId, "invoice");
  if (typeof line.livemode !== "boolean" || typeof line.currency !== "string")
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  if (line.livemode !== context.livemode)
    throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
  material(line.currency === context.price.currency);
  const parent = invoiceRecordV1(line.parent);
  if (parent.type === "invoice_item_details") {
    invoiceRecordV1(parent.invoice_item_details);
    if (parent.subscription_item_details !== null)
      throw new InvoiceEvidenceStopV1("unsupported_profile");
    return null;
  }
  if (parent.type !== "subscription_item_details")
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  const details = invoiceRecordV1(parent.subscription_item_details);
  invoiceReferenceV1(
    details.subscription,
    context.subscriptionId,
    "subscription",
    context.subscription,
  );
  invoiceReferenceV1(
    details.subscription_item,
    context.itemId,
    "subscription_item",
  );
  if (details.proration !== false)
    throw new InvoiceEvidenceStopV1("unsupported_profile");
  if (line.subscription !== null && line.subscription !== undefined)
    invoiceReferenceV1(
      line.subscription,
      context.subscriptionId,
      "subscription",
      context.subscription,
    );
  const pricing = invoiceRecordV1(line.pricing);
  if (pricing.type === null || pricing.type === undefined)
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  if (pricing.type !== "price_details")
    throw new InvoiceEvidenceStopV1("unsupported_profile");
  const price = invoiceRecordV1(pricing.price_details);
  if (typeof price.price !== "string" || typeof price.product !== "string")
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  material(
    price.price === context.price.id && price.product === context.productId,
  );
  const period = invoiceRecordV1(line.period);
  if (
    typeof period.start !== "number" ||
    typeof period.end !== "number" ||
    !Number.isSafeInteger(period.start) ||
    !Number.isSafeInteger(period.end)
  )
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  material(
    period.start === context.period.start && period.end === context.period.end,
  );
  if (
    line.quantity_decimal === null ||
    line.quantity_decimal === undefined ||
    pricing.unit_amount_decimal === null ||
    pricing.unit_amount_decimal === undefined
  )
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  const quantity = decimal(line.quantity_decimal);
  material(sameInvoiceDecimalV1(quantity.raw, String(context.quantity)));
  material(
    sameInvoiceDecimalV1(
      pricing.unit_amount_decimal,
      context.price.unit_amount_decimal,
    ),
  );
  if (line.quantity !== null && line.quantity !== undefined) {
    if (
      typeof line.quantity !== "number" ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 0
    )
      throw new InvoiceEvidenceStopV1("unsupported_profile");
    material(
      BigInt(line.quantity) ===
        quantity.coefficient / 10n ** BigInt(quantity.scale),
    );
  }
  return {
    invoiceId: context.invoiceId,
    lineId: line.id,
    subscriptionItemId: context.itemId,
    nativePeriod: { start: context.period.start, end: context.period.end },
    priceId: price.price,
    productId: price.product,
    currency: String(line.currency),
    quantityDecimal: quantity.raw,
    unitAmountDecimal: decimal(pricing.unit_amount_decimal).raw,
    invoiceStatus: context.invoiceStatus,
  };
}
/** Complete bounded page DATA only, never cursor/request or provider provenance. */
export function inspectInvoiceLinesV1(
  raw: unknown,
  context: LineContext,
): InvoiceLineMatchV1 {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2)
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  const seen = new Set<string>(),
    candidates: InvoiceLineMatchV1[] = [];
  for (let index = 0; index < raw.length; index++) {
    const page = invoiceRecordV1(raw[index]);
    if (
      page.object !== "list" ||
      typeof page.has_more !== "boolean" ||
      !Array.isArray(page.data)
    )
      throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
    if (typeof page.url !== "string")
      throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
    if (page.url !== `/v1/invoices/${context.invoiceId}/lines`)
      throw new InvoiceEvidenceStopV1("invoice_relation_mismatch", "conflict");
    if (
      page.data.length > 100 ||
      (page.data.length === 0 && (raw.length > 1 || page.has_more)) ||
      page.has_more !== index < raw.length - 1
    )
      throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
    for (const row of page.data) {
      const line = invoiceRecordV1(row);
      if (typeof line.id !== "string" || seen.has(line.id))
        throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
      seen.add(line.id);
      const candidate = oneLine(line, context);
      if (candidate) candidates.push(candidate);
    }
  }
  if (candidates.length !== 1)
    throw new InvoiceEvidenceStopV1("incomplete_invoice_lines");
  return candidates[0];
}
