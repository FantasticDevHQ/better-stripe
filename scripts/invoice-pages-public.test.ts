import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "@fantastic.dev/better-stripe";
import { getStripeClient } from "../dist/client/helpers.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const key = `sk_test_compiled_invoice_${crypto.randomUUID()}`;
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const list = vi.spyOn(getStripeClient(key).invoices, "list");
  const ctx = { runQuery: vi.fn() };
  const row = {
    id: "in_first",
    customer_account: "acct_buyer",
    currency: "kwd",
    amount_paid: 1234,
    status_transitions: { paid_at: 123 },
    lines: { data: [], has_more: true },
  };
  return { client, list, ctx, row };
}

it("loads the compiled public export and preserves original KWD evidence", async () => {
  expect(import.meta.resolve("@fantastic.dev/better-stripe")).toMatch(
    /\/dist\/client\/index\.js$/,
  );
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.row], has_more: false } as never);
  await expect(
    f.client.getInvoicePageFromStripe(f.ctx, { customerAccount: "acct_buyer" }),
  ).resolves.toEqual({ page: [f.row], hasMore: false, continueCursor: null });
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});

it("normalizes filter ordering and permits a changed bounded page size", async () => {
  const f = fixture();
  f.list
    .mockResolvedValueOnce({ data: [f.row], has_more: true } as never)
    .mockResolvedValueOnce({ data: [], has_more: false } as never);
  const first = await f.client.getInvoicePageFromStripe(f.ctx, {
    customerAccount: "acct_buyer",
    created: { lte: 200, gte: 0 },
    limit: 1,
  });
  const last = await f.client.getInvoicePageFromStripe(f.ctx, {
    customerAccount: "acct_buyer",
    created: { gte: 0, lte: 200 },
    limit: 2,
    cursor: first.continueCursor,
  });
  expect(f.list).toHaveBeenLastCalledWith({
    customer_account: "acct_buyer",
    created: { gte: 0, lte: 200 },
    limit: 2,
    starting_after: "in_first",
  });
  expect(last).toEqual({ page: [], hasMore: false, continueCursor: null });
});

it("rejects a non-advancing provider continuation in the compiled package", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.row], has_more: true } as never);
  const first = await f.client.getInvoicePageFromStripe(f.ctx, {
    customerAccount: "acct_buyer",
    created: {},
  });
  await expect(
    f.client.getInvoicePageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/continuation/i);
});
