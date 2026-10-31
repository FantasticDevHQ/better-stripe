import { observationData as object } from "./types.js";
import type {
  ObservationReadRow,
  ObservationReads,
  ObservationRecord,
} from "./types.js";
import type { InvoiceContextV1 } from "../../../renewalObservation/evidence-v1-types.js";
import { invoiceReferenceV1 } from "../../../renewalObservation/evidence-invoice-lines.js";
import { baseReadRows, validateBaseRouting } from "./profile.js";
import { matchConfigureDATA } from "../producer/configureJournalData.js";
import { captureReaderQueryDATA } from "./readerAuthorization.js";

export class InvoiceAcquisitionStop extends Error {
  constructor(
    readonly reason: string,
    readonly kind: "unavailable" | "conflict" = "unavailable",
  ) {
    super(reason);
  }
}
function need(
  value: unknown,
  reason: string,
  kind: "unavailable" | "conflict" = "unavailable",
): asserts value {
  if (!value) throw new InvoiceAcquisitionStop(reason, kind);
}
function pointer(
  raw: unknown,
  account: string,
  mode: boolean,
  customer: ReturnType<typeof object>,
  subscription: ReturnType<typeof object>,
) {
  need(raw !== null && raw !== undefined, "INVOICE_POINTER_UNAVAILABLE");
  const id = typeof raw === "string" ? raw : object(raw).id;
  need(
    typeof id === "string" && id.length <= 255 && /^in_[A-Za-z0-9_]+$/.test(id),
    "INVOICE_POINTER_INVALID",
  );
  if (typeof raw !== "string") {
    const expanded = object(raw);
    try {
      if (Object.prototype.hasOwnProperty.call(expanded, "customer"))
        invoiceReferenceV1(
          expanded.customer,
          String(customer.id),
          "customer",
          customer,
        );
      if (Object.prototype.hasOwnProperty.call(expanded, "parent")) {
        const parent = object(expanded.parent);
        need(
          parent.type === "subscription_details",
          "INVOICE_POINTER_SCOPE_MISMATCH",
          "conflict",
        );
        invoiceReferenceV1(
          object(parent.subscription_details).subscription,
          String(subscription.id),
          "subscription",
          subscription,
        );
      }
    } catch {
      throw new InvoiceAcquisitionStop(
        "INVOICE_POINTER_SCOPE_MISMATCH",
        "conflict",
      );
    }
    need(
      expanded.object === "invoice" && expanded.deleted !== true,
      "INVOICE_POINTER_INVALID",
    );
    need(
      (!Object.prototype.hasOwnProperty.call(expanded, "customer_account") ||
        expanded.customer_account === account) &&
        (!Object.prototype.hasOwnProperty.call(expanded, "livemode") ||
          expanded.livemode === mode),
      "INVOICE_POINTER_SCOPE_MISMATCH",
      "conflict",
    );
  }
  return id;
}
/** Fixed bounded acquisition plan from already captured complete DATA, never authority. */
export function createInvoiceReadPlan(
  record: ObservationRecord,
  reads: ObservationReads,
  startOrdinal: number,
) {
  validateBaseRouting(record, reads);
  const original = object(record.originalBundle.wireSubscription),
    current = object(reads.subscription);
  const customer = object(reads.billingCustomer),
    oldCustomer = object(record.originalBundle.wireBillingCustomer);
  const scope = record.configuration.preparation.expected;
  need(
    typeof oldCustomer.id === "string" && customer.id === oldCustomer.id,
    "INVOICE_CUSTOMER_MISMATCH",
    "conflict",
  );
  const originalInvoiceId = pointer(
    original.latest_invoice,
    scope.customerAccountId,
    scope.livemode,
    oldCustomer,
    original,
  );
  const currentInvoiceId = pointer(
    current.latest_invoice,
    scope.customerAccountId,
    scope.livemode,
    customer,
    current,
  );
  need(
    originalInvoiceId !== currentInvoiceId,
    "invoice_relation_mismatch",
    "conflict",
  );
  const pins = Object.freeze({
    originalInvoiceId,
    currentInvoiceId,
    customerId: oldCustomer.id,
  });
  const result = [
    { invoice: null as unknown, linePages: [] as unknown[] },
    { invoice: null as unknown, linePages: [] as unknown[] },
  ];
  let role = 0,
    stage: "invoice" | "lines" | "fence" | "done" = "invoice",
    cursor: string | null = null,
    count = 0;
  const seen = new Set<string>();
  const id = () => (role === 0 ? originalInvoiceId : currentInvoiceId);
  function row(): ObservationReadRow {
    need(stage !== "done" && count < 7, "INVOICE_READ_BUDGET");
    const path = `/v1/invoices/${encodeURIComponent(id())}`;
    return Object.freeze({
      resource:
        stage === "fence"
          ? "subscription"
          : stage === "invoice"
            ? "invoice"
            : "invoice_lines",
      id: stage === "fence" ? scope.subscriptionId : id(),
      ordinal: startOrdinal + count + 1,
      method: "GET",
      body: undefined,
      path:
        stage === "fence"
          ? baseReadRows(record)[1].path
          : stage === "invoice"
            ? path
            : `${path}/lines?limit=100${cursor === null ? "" : "&starting_after=" + encodeURIComponent(cursor)}`,
      options: Object.freeze({
        apiVersion: "2026-09-30.endive",
        maxNetworkRetries: 0,
      }),
    });
  }
  function accept(raw: unknown) {
    need(stage !== "done" && count++ < 7, "INVOICE_READ_BUDGET");
    const body = object(raw);
    if (stage === "fence") {
      try {
        matchConfigureDATA(body, current);
      } catch {
        throw new InvoiceAcquisitionStop(
          "SUBSCRIPTION_FENCE_DRIFT",
          "conflict",
        );
      }
      stage = "done";
      return;
    }
    if (stage === "invoice") {
      need(
        body.id === id() &&
          body.object === "invoice" &&
          body.deleted !== true &&
          body.customer_account === scope.customerAccountId &&
          body.livemode === scope.livemode,
        "INVOICE_SCOPE_MISMATCH",
        "conflict",
      );
      try {
        invoiceReferenceV1(
          body.customer,
          pins.customerId,
          "customer",
          role === 0 ? oldCustomer : customer,
        );
        const parent = object(body.parent);
        need(
          parent.type === "subscription_details",
          "INVOICE_SUBSCRIPTION_MISMATCH",
          "conflict",
        );
        invoiceReferenceV1(
          object(parent.subscription_details).subscription,
          scope.subscriptionId,
          "subscription",
          role === 0 ? original : current,
        );
        invoiceReferenceV1(
          (role === 0 ? original : current).latest_invoice,
          id(),
          "invoice",
          body,
        );
      } catch (error) {
        if (error instanceof InvoiceAcquisitionStop) throw error;
        throw new InvoiceAcquisitionStop(
          "INVOICE_RELATION_MISMATCH",
          "conflict",
        );
      }
      result[role].invoice = raw;
      stage = "lines";
    } else {
      need(
        body.object === "list" &&
          body.url === `/v1/invoices/${id()}/lines` &&
          typeof body.has_more === "boolean" &&
          Array.isArray(body.data),
        "INVOICE_LINES_INCOMPLETE",
      );
      const rows = body.data;
      need(
        rows.length <= 100 &&
          !(rows.length === 0 && (body.has_more || cursor !== null)),
        "INVOICE_LINES_INCOMPLETE",
      );
      for (const value of rows) {
        const line = object(value);
        need(
          line.object === "line_item" && line.livemode === scope.livemode,
          "INVOICE_LINE_SCOPE_MISMATCH",
          "conflict",
        );
        try {
          invoiceReferenceV1(line.invoice, id(), "invoice");
        } catch {
          throw new InvoiceAcquisitionStop(
            "INVOICE_LINE_SCOPE_MISMATCH",
            "conflict",
          );
        }
        need(
          typeof line.id === "string" &&
            line.id.length <= 255 &&
            /^il_[A-Za-z0-9_]+$/.test(line.id) &&
            !seen.has(line.id),
          "INVOICE_CURSOR_INVALID",
        );
        seen.add(line.id);
      }
      need(!(cursor !== null && body.has_more), "INVOICE_PAGE_BUDGET");
      result[role].linePages.push(raw);
      if (body.has_more) cursor = String(object(rows[rows.length - 1]).id);
      else if (role === 0) {
        role = 1;
        stage = "invoice";
        cursor = null;
      } else stage = "fence";
    }
    captureReaderQueryDATA(result);
  }
  return Object.freeze({
    pins,
    row,
    accept,
    done: () => stage === "done",
    context(): InvoiceContextV1 {
      need(stage === "done", "INVOICE_LINES_INCOMPLETE");
      return captureReaderQueryDATA({
        original: result[0],
        current: result[1],
      });
    },
  });
}
