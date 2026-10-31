import { afterEach, expect, it, vi } from "vitest";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import { object } from "./common.js";
import type { InvoiceEvidenceV1, Reason } from "./evidence-v1-types.js";
import {
  invoiceRecipe,
  invoiceMatch,
  currentTarget,
  evidence,
  activeLifecycle,
  prerequisites,
  bounded,
  set,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";

afterEach(() => vi.unstubAllGlobals());
const controls = [
  "I0-manual",
  "I1-create",
  "invoice-parent",
  "line-sub",
  "line-item",
  "invoice-id",
  "customer",
  "account",
  "mode",
  "price",
  "product",
  "currency",
  "native-end",
  "fractional-quantity",
  "decimal-price-drift",
  "large-decimal-one-unit",
  "quantity-only",
  "legacy-line-only",
  "null-parent",
  "numeric-decimal",
  "too-precise-decimal",
  "duplicate-eligible",
  "duplicate-page",
  "nonprogress",
  "incomplete-page-two",
  "wrong-page-url",
  "too-many-pages",
  "too-many-lines",
  "full-settings-drift",
  "unrelated-supplied-invoice",
] as const;
it.each(controls)("unsigned invoice refusal %s", async (control) => {
  const f = invoiceRecipe(
    "subscription_create",
    "open",
    control === "large-decimal-one-unit" ? "large-decimal" : "standard",
  );
  const addon = (id: string) => {
    const row = structuredClone(f.currentLine);
    set(row, "id", id);
    set(row, "subscription", null);
    set(row, "parent", {
      type: "invoice_item_details",
      subscription_item_details: null,
      invoice_item_details: {
        invoice_item: "ii_declared_extra",
        proration: false,
      },
    });
    return row;
  };
  let reason: Reason = "invoice_relation_mismatch";
  let predicate: "unknown" | "conflict" = "conflict";
  if (control === "I0-manual" || control === "I1-create") {
    set(
      control === "I0-manual" ? f.originalInvoice : f.currentInvoice,
      "billing_reason",
      control === "I0-manual" ? "manual" : "subscription_create",
    );
    reason = "unsupported_invoice_reason";
    predicate = "unknown";
  }
  if (control === "invoice-parent")
    set(
      f.currentInvoice.parent.subscription_details,
      "subscription",
      "sub_foreign",
    );
  if (control === "line-sub")
    set(
      f.currentLine.parent.subscription_item_details,
      "subscription",
      "sub_foreign",
    );
  if (control === "line-item")
    set(
      f.currentLine.parent.subscription_item_details,
      "subscription_item",
      "si_foreign",
    );
  if (control === "invoice-id") set(f.currentInvoice, "id", "in_foreign");
  if (control === "customer") set(f.currentInvoice, "customer", "cus_foreign");
  if (control === "account")
    set(f.currentInvoice, "customer_account", "acct_foreign");
  if (control === "mode") set(f.currentInvoice, "livemode", true);
  if (control === "price" || control === "product") {
    set(
      f.currentLine.pricing.price_details,
      control,
      control === "price" ? "price_foreign" : "prod_foreign",
    );
    reason = "invoice_material_mismatch";
  }
  if (control === "currency") {
    set(f.currentLine, "currency", "eur");
    reason = "invoice_material_mismatch";
  }
  if (control === "native-end") {
    set(f.currentLine.period, "end", f.currentLine.period.end - 1);
    reason = "invoice_material_mismatch";
  }
  if (control === "fractional-quantity") {
    set(f.currentLine, "quantity_decimal", "3.5");
    reason = "invoice_material_mismatch";
  }
  if (control === "decimal-price-drift") {
    set(f.currentLine.pricing, "unit_amount_decimal", "2000.000000000001");
    reason = "invoice_material_mismatch";
  }
  if (control === "large-decimal-one-unit") {
    const original = f.currentLine.pricing.unit_amount_decimal;
    const changed = "9007199254740991.000000000002";
    expect(
      BigInt(changed.replace(".", "")) - BigInt(original.replace(".", "")),
    ).toBe(1n);
    // This offline illusion is why the production comparison may not use Number.
    expect(Number(changed)).toBe(Number(original));
    set(f.currentLine.pricing, "unit_amount_decimal", changed);
    reason = "invoice_material_mismatch";
  }
  if (control === "quantity-only") {
    set(f.currentLine, "quantity_decimal", null);
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "legacy-line-only") {
    set(f.currentLine, "parent", null);
    set(f.currentLine, "pricing", null);
    set(f.currentLine, "price", {
      id: "price_target",
      product: "custom-target",
    });
    set(f.currentLine, "subscription_item", "si_successor");
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "null-parent") {
    set(f.currentInvoice, "parent", null);
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "numeric-decimal" || control === "too-precise-decimal") {
    set(
      f.currentLine.pricing,
      "unit_amount_decimal",
      control === "numeric-decimal" ? 2000 : "2000.0000000000001",
    );
    reason = "unsupported_profile";
    predicate = "unknown";
  }
  if (control === "duplicate-eligible") {
    const duplicate = structuredClone(f.currentLine);
    set(duplicate, "id", "il_duplicate_eligible");
    set(f.currentPages[0], "data", [f.currentLine, duplicate]);
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "duplicate-page") {
    set(f.currentPages[0], "has_more", true);
    f.currentPages.push({
      ...structuredClone(f.currentPages[0]),
      has_more: false,
    });
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "incomplete-page-two" || control === "too-many-pages") {
    set(f.currentPages[0], "data", [addon("il_page_one_extra")]);
    set(f.currentPages[0], "has_more", true);
    f.currentPages.push({
      object: "list",
      url: f.currentPages[0].url,
      has_more: true,
      data:
        control === "too-many-pages"
          ? [addon("il_page_two_extra")]
          : [f.currentLine],
    });
    if (control === "too-many-pages")
      f.currentPages.push({
        object: "list",
        url: f.currentPages[0].url,
        has_more: false,
        data: [f.currentLine],
      });
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "nonprogress") {
    set(f.currentPages[0], "data", []);
    set(f.currentPages[0], "has_more", true);
    f.currentPages.push({
      object: "list",
      url: f.currentPages[0].url,
      has_more: false,
      data: [f.currentLine],
    });
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "wrong-page-url")
    set(f.currentPages[0], "url", "/v1/invoices/in_foreign/lines");
  if (control === "too-many-lines") {
    set(f.currentPages[0], "data", [
      f.currentLine,
      ...Array.from({ length: 100 }, (_, index) => addon(`il_bound_${index}`)),
    ]);
    reason = "incomplete_invoice_lines";
    predicate = "unknown";
  }
  if (control === "full-settings-drift")
    set(
      object(f.h.input.reads.subscription),
      "description",
      "TEST_FULL_SUBSCRIPTION_DRIFT",
    );
  if (control === "unrelated-supplied-invoice")
    set(object(f.h.input.reads.subscription), "latest_invoice", "in_original");
  const invoiceEvidence: InvoiceEvidenceV1 =
    control === "full-settings-drift"
      ? invoiceMatch(f)
      : { predicate, original: null, current: null, reason };
  const currentMaterial =
    control === "unrelated-supplied-invoice"
      ? currentTarget(f.h.input)
      : control === "full-settings-drift"
        ? {
            predicate: "conflict" as const,
            observedItemId: null,
            nativePeriod: null,
            reason: "material_mismatch" as const,
          }
        : {
            predicate: "unknown" as const,
            observedItemId: null,
            nativePeriod: null,
            reason: "incomplete_material" as const,
          };
  const expected = {
    ...evidence(f.h.input, activeLifecycle, currentMaterial),
    invoiceEvidence,
  };
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_FETCH");
  });
  await prerequisites(f.h);
  const before = bounded(f.h.input);
  let targetFailed = false;
  try {
    const actual = await inspectRenewalEvidenceV1(f.h.input);
    expect(actual).toEqual(expected);
    expect(Reflect.ownKeys(actual)).toHaveLength(12);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(f.h.input).toEqual(before);
      expect(fetchCalls).toBe(0);
      console.info(
        "EVIDENCE_INVOICE_CONTROL_SETTLEMENT",
        JSON.stringify({
          control,
          targetReached: true,
          inputUnchanged: true,
          fetchCalls,
        }),
      );
    } catch (error) {
      if (!targetFailed) throw error;
      console.info("EVIDENCE_INVOICE_CONTROL_INSPECTION_FAILED");
    }
  }
});
