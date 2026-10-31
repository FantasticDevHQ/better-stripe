import { expect, it } from "vitest";
import { inspectRenewalEvidenceV1 } from "./evidence-v1.js";
import { object } from "./common.js";
import {
  invoiceRecipe,
  prerequisites,
  bounded,
  set,
} from "../../../../tests/renewalObservation/evidenceFixtures.js";

it.each(["string", "minimal-expanded", "full-expanded"] as const)(
  "one invoice ID cannot prove two renewal invoices with %s pointers",
  async (pointer) => {
    const f = invoiceRecipe("subscription_cycle", "open");
    await prerequisites(f.h);
    const positive = await inspectRenewalEvidenceV1(f.h.input);
    expect(positive.invoiceEvidence.predicate).toBe("invoice_lines_correlated");

    // Keep two otherwise valid period/item inventories. Every current relation
    // now names I0, so a foreign-ID refusal cannot mask the missing invariant.
    const id = f.originalInvoice.id;
    set(f.currentInvoice, "id", id);
    set(f.currentLine, "invoice", id);
    set(f.currentPages[0], "url", `/v1/invoices/${id}/lines`);
    set(
      object(f.h.input.reads.subscription),
      "latest_invoice",
      pointer === "string"
        ? id
        : pointer === "minimal-expanded"
          ? { id, object: "invoice" }
          : structuredClone(f.currentInvoice),
    );
    const before = bounded(f.h.input);
    const result = await inspectRenewalEvidenceV1(f.h.input);
    expect(result.invoiceEvidence).toEqual({
      predicate: "conflict",
      original: null,
      current: null,
      reason: "invoice_relation_mismatch",
    });
    expect(result.operationalAuthority).toBe(false);
    expect(result.authenticationEstablished).toBe(false);
    expect(result.acknowledgementEstablished).toBe(false);
    expect(Reflect.ownKeys(result)).toHaveLength(12);
    expect(f.h.input).toEqual(before);
  },
);

it("distinct invoices cannot reuse one line ID for incompatible period inventories", async () => {
  const f = invoiceRecipe("subscription_cycle", "open");
  await prerequisites(f.h);
  set(f.currentLine, "id", f.originalLine.id);
  const result = await inspectRenewalEvidenceV1(f.h.input);
  expect(result.invoiceEvidence).toEqual({
    predicate: "conflict",
    original: null,
    current: null,
    reason: "invoice_relation_mismatch",
  });
});
