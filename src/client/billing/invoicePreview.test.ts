import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { getUpcomingInvoicePreview } from "./invoicePreview.js";

const opts = {
  customerAccount: "acct_buyer",
  stripeSubscriptionId: "sub_test",
};
const line = (id: string, amount = 100) => ({
  id,
  amount,
  currency: "usd",
  description: "Subscription",
  period: { start: 1800000000, end: 1802592000 },
});
function fixture(hasMore = false) {
  const raw = {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        id: opts.stripeSubscriptionId,
        customer_account: opts.customerAccount,
        items: { data: [{ current_period_end: 1800000000 }] },
      }),
    },
    invoices: {
      createPreview: vi.fn().mockResolvedValue({
        id: "in_preview",
        currency: "usd",
        total: 275,
        subtotal: 300,
        amount_due: 275,
        period_start: 1800000000,
        period_end: 1802592000,
        lines: { data: [line("il_first")], has_more: hasMore },
      }),
      listLineItems: vi.fn().mockImplementation(async function* () {
        yield line("il_first");
        yield line("il_second", 200);
      }),
    },
  };
  return { raw, stripe: raw as unknown as Stripe };
}
describe("authoritative upcoming invoice preview", () => {
  it("keeps provider totals and converts dates to milliseconds", async () => {
    const { raw, stripe } = fixture();
    const preview = await getUpcomingInvoicePreview(stripe, opts);
    expect(preview).toMatchObject({
      total: 275,
      subtotal: 300,
      amountDue: 275,
      currency: "usd",
      nextBillingAt: 1800000000000,
      linesComplete: true,
      periodStart: 1800000000000,
      periodEnd: 1802592000000,
      lines: [{ id: "il_first", amount: 100, periodStart: 1800000000000 }],
    });
    expect(raw.invoices.createPreview).toHaveBeenCalledWith({
      customer_account: "acct_buyer",
      subscription: "sub_test",
    });
    expect(raw.invoices.listLineItems).not.toHaveBeenCalled();
  });
  it("loads every provider line when the initial embedded page is truncated", async () => {
    const { raw, stripe } = fixture(true);
    expect(
      (await getUpcomingInvoicePreview(stripe, opts)).lines.map((l) => l.id),
    ).toEqual(["il_first", "il_second"]);
    expect(raw.invoices.listLineItems).toHaveBeenCalledWith("in_preview", {
      limit: 100,
    });
  });
  it("rejects a subscription owned by a different account before creating a preview", async () => {
    const { raw, stripe } = fixture();
    raw.subscriptions.retrieve.mockResolvedValueOnce({
      customer_account: "acct_other",
    });
    await expect(getUpcomingInvoicePreview(stripe, opts)).rejects.toThrow(
      "does not belong",
    );
    expect(raw.invoices.createPreview).not.toHaveBeenCalled();
  });
  it("preserves unavailable preview errors and does not return partial pagination", async () => {
    const { raw, stripe } = fixture(true);
    const unavailable = Object.assign(new Error("No upcoming invoice"), {
      code: "invoice_upcoming_none",
    });
    raw.invoices.createPreview.mockRejectedValueOnce(unavailable);
    await expect(getUpcomingInvoicePreview(stripe, opts)).rejects.toBe(
      unavailable,
    );
    const failedPage = new Error("Provider page unavailable");
    raw.invoices.listLineItems.mockImplementationOnce(async function* () {
      yield line("il_first");
      throw failedPage;
    });
    await expect(getUpcomingInvoicePreview(stripe, opts)).rejects.toBe(
      failedPage,
    );
  });
  it("rejects inconsistent currency or fractional provider amounts", async () => {
    const { raw, stripe } = fixture();
    const preview = await raw.invoices.createPreview();
    raw.invoices.createPreview.mockResolvedValueOnce({
      ...preview,
      total: 1.5,
    });
    await expect(getUpcomingInvoicePreview(stripe, opts)).rejects.toThrow(
      "integer",
    );
    raw.invoices.createPreview.mockResolvedValueOnce({
      ...preview,
      lines: {
        data: [{ ...line("il_bad"), currency: "eur" }],
        has_more: false,
      },
    });
    await expect(getUpcomingInvoicePreview(stripe, opts)).rejects.toThrow(
      "currency",
    );
  });
});
