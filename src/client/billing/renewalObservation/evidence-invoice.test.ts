import { afterEach, expect, it, vi } from "vitest";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import { object, get } from "./common.js";
import {
  invoiceRecipe,
  invoiceMatch,
  currentTarget,
  evidence,
  activeLifecycle,
  prerequisites,
  bounded,
  set,
  type InvoiceStatus,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";

afterEach(() => vi.unstubAllGlobals());
const statuses: InvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
  null,
];
const positives = statuses.flatMap((status) =>
  (["subscription_create", "subscription_cycle"] as const).map(
    (originalReason) => ({ status, originalReason }),
  ),
);
it.each(positives)(
  "unsigned invoice correlation I0=$originalReason status=$status",
  async ({ status, originalReason }) => {
    const f = invoiceRecipe(originalReason, status);
    const expected = {
      ...evidence(f.h.input, activeLifecycle, currentTarget(f.h.input)),
      invoiceEvidence: invoiceMatch(f),
    };
    let fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw Error("UNEXPECTED_FETCH");
    });
    await prerequisites(f.h);
    // Independent raw pointer/SI/native-period joins; no paid-status inference.
    expect(
      object(f.h.input.configuration.preparation.subscription).latest_invoice,
    ).toBe(f.originalInvoice.id);
    expect(object(f.h.input.reads.subscription).latest_invoice).toBe(
      f.currentInvoice.id,
    );
    expect(
      f.originalLine.parent.subscription_item_details.subscription_item,
    ).toBe("si_original");
    expect(
      f.currentLine.parent.subscription_item_details.subscription_item,
    ).toBe("si_successor");
    expect(f.currentLine.period).toEqual(expected.currentMaterial.nativePeriod);
    expect(f.originalLine.period).toEqual(
      expected.identity?.originalNativePeriod,
    );
    const before = bounded(f.h.input);
    let targetFailed = false;
    try {
      const actual = await inspectRenewalEvidenceV1(f.h.input);
      expect(actual).toEqual(expected);
      expect(Reflect.ownKeys(actual)).toHaveLength(12);
      expect(actual.acknowledgementEstablished).toBe(false);
      expect(actual.authenticationEstablished).toBe(false);
      expect(actual.operationalAuthority).toBe(false);
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(f.h.input).toEqual(before);
        expect(fetchCalls).toBe(0);
        console.info(
          "EVIDENCE_INVOICE_SETTLEMENT",
          JSON.stringify({
            originalReason,
            status,
            targetReached: true,
            inputUnchanged: true,
            fetchCalls,
          }),
        );
      } catch (error) {
        if (!targetFailed) throw error;
        console.info("EVIDENCE_INVOICE_INSPECTION_FAILED");
      }
    }
  },
);
it.each(["decimal-text", "complete-page-two", "large-decimal"] as const)(
  "unsigned invoice correlation %s",
  async (control) => {
    const f = invoiceRecipe(
      "subscription_create",
      "open",
      control === "large-decimal" ? "large-decimal" : "standard",
    );
    if (control === "decimal-text") {
      set(f.originalLine, "quantity_decimal", "3.000");
      set(f.currentLine, "quantity_decimal", "3.0");
      set(f.originalLine.pricing, "unit_amount_decimal", "1000.000");
      set(f.currentLine.pricing, "unit_amount_decimal", "2000.00");
    } else if (control === "complete-page-two") {
      const extra = structuredClone(f.currentLine);
      set(extra, "id", "il_non_subscription");
      set(extra, "subscription", null);
      set(extra, "parent", {
        type: "invoice_item_details",
        subscription_item_details: null,
        invoice_item_details: {
          invoice_item: "ii_declared_extra",
          proration: false,
        },
      });
      set(f.currentPages[0], "data", [extra]);
      set(f.currentPages[0], "has_more", true);
      f.currentPages.push({
        object: "list",
        url: f.currentPages[0].url,
        has_more: false,
        data: [f.currentLine],
      });
    }
    const expected = {
      ...evidence(f.h.input, activeLifecycle, currentTarget(f.h.input)),
      invoiceEvidence: invoiceMatch(f),
    };
    let fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls++;
      throw Error("UNEXPECTED_FETCH");
    });
    await prerequisites(f.h);
    expect(get(object(f.h.input.reads.subscription), "items").has_more).toBe(
      false,
    );
    expect(f.currentPages[f.currentPages.length - 1]?.has_more).toBe(false);
    const before = bounded(f.h.input);
    let targetFailed = false;
    try {
      const actual = await inspectRenewalEvidenceV1(f.h.input);
      expect(actual).toEqual(expected);
      if (actual.invoiceEvidence.predicate === "invoice_lines_correlated") {
        expect(actual.invoiceEvidence.original.quantityDecimal).toBe(
          f.originalLine.quantity_decimal,
        );
        expect(actual.invoiceEvidence.current.unitAmountDecimal).toBe(
          f.currentLine.pricing.unit_amount_decimal,
        );
      }
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(f.h.input).toEqual(before);
        expect(fetchCalls).toBe(0);
        console.info(
          "EVIDENCE_INVOICE_SETTLEMENT",
          JSON.stringify({
            control,
            targetReached: true,
            inputUnchanged: true,
            fetchCalls,
          }),
        );
      } catch (error) {
        if (!targetFailed) throw error;
        console.info("EVIDENCE_INVOICE_INSPECTION_FAILED");
      }
    }
  },
);
