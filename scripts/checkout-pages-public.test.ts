import type {
  CheckoutSessionPageOptions,
  ProviderCheckoutSessionPage,
} from "@fantastic.dev/better-stripe";
import { BetterStripe } from "@fantastic.dev/better-stripe";
import { afterEach, expect, it, vi } from "vitest";
import { getStripeClient } from "../dist/client/helpers.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const key = `sk_test_public_checkout_page_${crypto.randomUUID()}`;
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const list = vi.spyOn(getStripeClient(key).checkout.sessions, "list");
  const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
  const row = {
    id: "cs_original",
    object: "checkout.session",
    created: 100,
    customer_account: "acct_buyer",
    customer: null,
    status: "complete",
    payment_status: "unpaid",
    currency: "kwd",
    amount_total: 1234,
    payment_intent: { id: "pi_original", status: "processing" },
    subscription: null,
    metadata: { communityId: "community_original" },
  };
  return { client, list, ctx, row };
}

it("ships the inherited public reader/types and preserves asynchronous raw references", async () => {
  expect(import.meta.resolve("@fantastic.dev/better-stripe")).toMatch(
    /\/dist\/client\/index\.js$/,
  );
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.row], has_more: false } as never);
  const opts: CheckoutSessionPageOptions = { customerAccount: "acct_buyer" };
  const page: ProviderCheckoutSessionPage =
    await f.client.getCheckoutSessionPageFromStripe(f.ctx, opts);
  expect(page).toEqual({ page: [f.row], hasMore: false, continueCursor: null });
  expect(page.page[0]).toBe(f.row);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
  expect(f.ctx.runMutation).not.toHaveBeenCalled();
});

it("continues actual compiled pages and refuses a foreign-account cursor before I/O", async () => {
  const f = fixture();
  f.list.mockResolvedValueOnce({ data: [f.row], has_more: true } as never);
  const first = await f.client.getCheckoutSessionPageFromStripe(f.ctx, {
    customerAccount: "acct_buyer",
    status: "complete",
    created: { lte: 200 },
    limit: 1,
  });
  f.list.mockClear();
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_foreign",
      status: "complete",
      created: { lte: 200 },
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/cursor|scope/i);
  expect(f.list).not.toHaveBeenCalled();
  f.list.mockResolvedValueOnce({ data: [], has_more: false } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
      status: "complete",
      created: { lte: 200 },
      cursor: first.continueCursor,
    }),
  ).resolves.toEqual({ page: [], hasMore: false, continueCursor: null });
  expect(f.list).toHaveBeenLastCalledWith({
    customer_account: "acct_buyer",
    status: "complete",
    created: { lte: 200 },
    limit: 25,
    starting_after: "cs_original",
  });
});

it.each([
  { customer_account: "acct_foreign" },
  { customer: "cus_legacy" },
  { object: "invoice" },
])(
  "rejects foreign or invalid provider identity through the compiled export %#",
  async (change) => {
    const f = fixture();
    f.list.mockResolvedValue({
      data: [{ ...f.row, ...change }],
      has_more: false,
    } as never);
    await expect(
      f.client.getCheckoutSessionPageFromStripe(f.ctx, {
        customerAccount: "acct_buyer",
      }),
    ).rejects.toThrow(/scope|identity/i);
  },
);

it("rejects repeated, empty nonterminal and duplicate pages in the compiled export", async () => {
  const f = fixture();
  f.list.mockResolvedValueOnce({ data: [f.row], has_more: true } as never);
  const first = await f.client.getCheckoutSessionPageFromStripe(f.ctx, {
    customerAccount: "acct_buyer",
  });
  f.list.mockResolvedValueOnce({ data: [f.row], has_more: false } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/continuation/i);
  f.list.mockResolvedValueOnce({ data: [], has_more: true } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
    }),
  ).rejects.toThrow(/continuation/i);
  f.list.mockResolvedValueOnce({
    data: [f.row, f.row],
    has_more: false,
  } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
    }),
  ).rejects.toThrow(/duplicate/i);
});

it("keeps provider errors distinct from exhausted history in the public artifact", async () => {
  const f = fixture();
  const failure = new Error("provider unavailable");
  f.list.mockRejectedValue(failure);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      customerAccount: "acct_buyer",
    }),
  ).rejects.toBe(failure);
});
