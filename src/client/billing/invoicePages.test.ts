import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient } from "../helpers.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const key = `sk_test_invoice_page_${crypto.randomUUID()}`;
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const list = vi.spyOn(getStripeClient(key).invoices, "list");
  const ctx = { runQuery: vi.fn() };
  const invoice = (id: string, customerAccount = "acct_buyer") => ({
    id,
    object: "invoice",
    customer_account: customerAccount,
    status: "paid",
    currency: "jpy",
    amount_paid: 1234,
    status_transitions: { paid_at: 100 },
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_buyer" },
    },
    lines: { data: [{ id: "il_first" }], has_more: true },
  });
  return {
    client,
    list,
    ctx,
    invoice,
    opts: { customerAccount: "acct_buyer" },
  };
}

it("reads one bounded V2 buyer provider page preserving exact invoice evidence", async () => {
  const f = fixture();
  const row = f.invoice("in_first");
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  const result = await f.client.getInvoicePageFromStripe(f.ctx, f.opts);
  expect(f.list).toHaveBeenCalledExactlyOnceWith({
    customer_account: "acct_buyer",
    limit: 25,
  });
  expect(result).toEqual({ page: [row], hasMore: false, continueCursor: null });
  expect(result.page[0]?.lines.has_more).toBe(true);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});

it("resumes provider pages with the original account and filter scope", async () => {
  const f = fixture();
  f.list
    .mockResolvedValueOnce({
      data: [f.invoice("in_newer")],
      has_more: true,
    } as never)
    .mockResolvedValueOnce({
      data: [f.invoice("in_older")],
      has_more: false,
    } as never);
  const opts = {
    ...f.opts,
    status: "paid" as const,
    created: { gte: 0, lte: 200 },
    limit: 1,
  };
  const first = await f.client.getInvoicePageFromStripe(f.ctx, opts);
  expect(first.hasMore).toBe(true);
  expect(first.continueCursor).toEqual(expect.any(String));
  const second = await f.client.getInvoicePageFromStripe(f.ctx, {
    ...opts,
    cursor: first.continueCursor,
  });
  expect(f.list).toHaveBeenLastCalledWith({
    customer_account: "acct_buyer",
    status: "paid",
    created: { gte: 0, lte: 200 },
    limit: 1,
    starting_after: "in_newer",
  });
  expect(second.page.map((row) => row.id)).toEqual(["in_older"]);
  expect(second.continueCursor).toBeNull();
});

it("rejects a continuation reused with a different buyer, status or window", async () => {
  const f = fixture();
  f.list.mockResolvedValue({
    data: [f.invoice("in_first")],
    has_more: true,
  } as never);
  const opts = { ...f.opts, status: "paid" as const, created: { lte: 200 } };
  const first = await f.client.getInvoicePageFromStripe(f.ctx, opts);
  for (const change of [
    { customerAccount: "acct_other" },
    { status: "open" as const },
    { created: { lte: 201 } },
  ]) {
    await expect(
      f.client.getInvoicePageFromStripe(f.ctx, {
        ...opts,
        ...change,
        cursor: first.continueCursor,
      }),
    ).rejects.toThrow(/cursor|scope/i);
  }
  expect(f.list).toHaveBeenCalledTimes(1);
});

it.each([
  { customerAccount: "cus_wrong" },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { cursor: "not-json" },
  { created: { gte: 20, lte: 10 } },
])("rejects invalid selectors before provider reads %#", async (change) => {
  const f = fixture();
  await expect(
    f.client.getInvoicePageFromStripe(f.ctx, { ...f.opts, ...change }),
  ).rejects.toThrow();
  expect(f.list).not.toHaveBeenCalled();
});

it("preserves provider failure identity instead of returning an empty completed page", async () => {
  const f = fixture();
  const failure = Object.assign(new Error("provider unavailable"), {
    code: "api_error",
  });
  f.list.mockRejectedValue(failure);
  await expect(f.client.getInvoicePageFromStripe(f.ctx, f.opts)).rejects.toBe(
    failure,
  );
});

it("rejects foreign buyer rows instead of exposing mismatched invoice evidence", async () => {
  const f = fixture();
  f.list.mockResolvedValue({
    data: [f.invoice("in_foreign", "acct_other")],
    has_more: false,
  } as never);
  await expect(
    f.client.getInvoicePageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/scope|buyer/i);
});

it("rejects an empty has-more page rather than inventing a terminal cursor", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [], has_more: true } as never);
  await expect(
    f.client.getInvoicePageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/continuation|page/i);
});

it("preserves repeated observations across pages without asserting immutable payment state", async () => {
  const f = fixture();
  f.list
    .mockResolvedValueOnce({
      data: [f.invoice("in_first")],
      has_more: true,
    } as never)
    .mockResolvedValueOnce({
      data: [
        { ...f.invoice("in_first"), amount_paid: 1200 },
        f.invoice("in_next"),
      ],
      has_more: true,
    } as never);
  const first = await f.client.getInvoicePageFromStripe(f.ctx, f.opts);
  const second = await f.client.getInvoicePageFromStripe(f.ctx, {
    ...f.opts,
    cursor: first.continueCursor,
  });
  expect(second.page.map((row) => row.id)).toEqual(["in_first", "in_next"]);
  expect(second.page[0]?.amount_paid).toBe(1200);
  expect(second.hasMore).toBe(true);
});
