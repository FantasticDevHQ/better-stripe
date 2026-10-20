import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient } from "../helpers.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const key = `sk_test_checkout_page_${crypto.randomUUID()}`;
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const list = vi.spyOn(getStripeClient(key).checkout.sessions, "list");
  const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
  const session = (id: string, customerAccount = "acct_buyer") => ({
    id,
    object: "checkout.session",
    customer_account: customerAccount,
    customer: null,
    status: "open",
    payment_status: "unpaid",
    mode: "subscription",
    created: 100,
    metadata: { dojoPurchaseIntentId: "intent_original" },
    subscription: null,
    payment_intent: null,
  });
  return {
    client,
    list,
    ctx,
    session,
    opts: { customerAccount: "acct_buyer" },
  };
}

it("reads a bounded public V2 buyer Checkout page without syncing or claiming completeness", async () => {
  const f = fixture();
  const row = f.session("cs_test_original");
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  expect(f.client.getCheckoutSessionPageFromStripe).toEqual(
    expect.any(Function),
  );
  const result = await f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts);
  expect(f.list).toHaveBeenCalledExactlyOnceWith({
    customer_account: "acct_buyer",
    limit: 25,
  });
  expect(result).toEqual({ page: [row], hasMore: false, continueCursor: null });
  expect(result.page[0]).toBe(row);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
  expect(f.ctx.runMutation).not.toHaveBeenCalled();
});

it("accepts the V2 buyer identity alongside its legacy customer projection", async () => {
  const f = fixture();
  const row = {
    ...f.session("cs_test_dual_identity"),
    customer: "cus_projection",
  };
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  const result = await f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts);
  expect(result).toEqual({ page: [row], hasMore: false, continueCursor: null });
  expect(result.page[0]).toBe(row);
  expect(f.list).toHaveBeenCalledExactlyOnceWith({
    customer_account: "acct_buyer",
    limit: 25,
  });
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
  expect(f.ctx.runMutation).not.toHaveBeenCalled();
});

it("resumes with canonical filters while allowing a different bounded page size", async () => {
  const f = fixture();
  f.list
    .mockResolvedValueOnce({
      data: [f.session("cs_newer")],
      has_more: true,
    } as never)
    .mockResolvedValueOnce({
      data: [f.session("cs_older")],
      has_more: false,
    } as never);
  const first = await f.client.getCheckoutSessionPageFromStripe(f.ctx, {
    ...f.opts,
    status: "open",
    created: { lte: 200, gte: 0 },
    limit: 1,
  });
  expect(first.continueCursor).toEqual(expect.any(String));
  const next = await f.client.getCheckoutSessionPageFromStripe(f.ctx, {
    ...f.opts,
    status: "open",
    created: { gte: 0, lte: 200 },
    limit: 2,
    cursor: first.continueCursor,
  });
  expect(f.list).toHaveBeenLastCalledWith({
    customer_account: "acct_buyer",
    status: "open",
    created: { gte: 0, lte: 200 },
    limit: 2,
    starting_after: "cs_newer",
  });
  expect(next).toEqual({
    page: [f.session("cs_older")],
    hasMore: false,
    continueCursor: null,
  });
});

it.each([
  { customerAccount: "acct_foreign" },
  { status: "expired" as const },
  { created: { lte: 201 } },
  { created: undefined },
])(
  "rejects continuation filter mutation before provider I/O %#",
  async (change) => {
    const f = fixture();
    f.list.mockResolvedValue({
      data: [f.session("cs_original")],
      has_more: true,
    } as never);
    const opts = { ...f.opts, status: "open" as const, created: { lte: 200 } };
    const first = await f.client.getCheckoutSessionPageFromStripe(f.ctx, opts);
    f.list.mockClear();
    await expect(
      f.client.getCheckoutSessionPageFromStripe(f.ctx, {
        ...opts,
        ...change,
        cursor: first.continueCursor,
      }),
    ).rejects.toThrow(/cursor|scope/i);
    expect(f.list).not.toHaveBeenCalled();
  },
);

it.each([
  { customerAccount: "cus_legacy" },
  { customerAccount: "acct_" },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { status: "paid" },
  { created: { gte: 2, lte: 1 } },
  { created: { gte: -1 } },
  { customer: "cus_legacy" },
  { cursor: "" },
  { cursor: "not a cursor" },
])(
  "rejects invalid public selectors before provider I/O %#",
  async (change) => {
    const f = fixture();
    await expect(
      f.client.getCheckoutSessionPageFromStripe(f.ctx, {
        ...f.opts,
        ...change,
      } as never),
    ).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
  },
);

it.each([
  { customer_account: "acct_foreign" },
  { customer_account: undefined },
  { customer_account: undefined, customer: "cus_legacy" },
  { customer_account: "acct_foreign", customer: "cus_legacy" },
  { id: "in_wrong_resource" },
  { object: "invoice" },
  { created: -1 },
])("rejects invalid provider buyer/resource identity %#", async (change) => {
  const f = fixture();
  f.list.mockResolvedValue({
    data: [{ ...f.session("cs_original"), ...change }],
    has_more: false,
  } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/scope|identity/i);
});

it.each([{ status: "expired" }, { created: 99 }, { created: 201 }])(
  "rejects a provider response outside the selected filters %#",
  async (change) => {
    const f = fixture();
    f.list.mockResolvedValue({
      data: [{ ...f.session("cs_original"), ...change }],
      has_more: false,
    } as never);
    await expect(
      f.client.getCheckoutSessionPageFromStripe(f.ctx, {
        ...f.opts,
        status: "open",
        created: { gte: 100, lte: 200 },
      }),
    ).rejects.toThrow(/scope|identity/i);
  },
);

it("preserves unknown lifecycle and raw expanded references without treating them as payment proof", async () => {
  const f = fixture();
  const row = {
    ...f.session("cs_async"),
    status: "future_provider_state",
    payment_status: "unpaid",
    currency: "kwd",
    amount_total: 1234,
    subscription: { id: "sub_original", status: "incomplete" },
    payment_intent: { id: "pi_original", status: "processing" },
    invoice: null,
    metadata: { communityId: "community_original" },
  };
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  const result = await f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts);
  expect(result.page[0]).toBe(row);
  expect(result).not.toHaveProperty("completeHistory");
});

it("rejects oversized, duplicate and nonadvancing provider pages", async () => {
  const f = fixture();
  const row = f.session("cs_original");
  f.list.mockResolvedValueOnce({
    data: [row, f.session("cs_second")],
    has_more: false,
  } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, { ...f.opts, limit: 1 }),
  ).rejects.toThrow(/page/i);
  f.list.mockResolvedValueOnce({ data: [row, row], has_more: false } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/duplicate|page/i);
  f.list.mockResolvedValueOnce({ data: [], has_more: true } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/continuation/i);
  f.list.mockResolvedValueOnce({ data: [row], has_more: true } as never);
  const first = await f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts);
  f.list.mockResolvedValueOnce({ data: [row], has_more: false } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      ...f.opts,
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/continuation/i);
});

it("normalizes an empty filter and returns an exhausted empty page", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [], has_more: false } as never);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, {
      ...f.opts,
      created: {},
      cursor: null,
    }),
  ).resolves.toEqual({ page: [], hasMore: false, continueCursor: null });
  expect(f.list).toHaveBeenCalledExactlyOnceWith({
    customer_account: "acct_buyer",
    limit: 25,
  });
});

it("propagates provider failure rather than turning it into empty history", async () => {
  const f = fixture();
  const failure = new Error("provider unavailable");
  f.list.mockRejectedValue(failure);
  await expect(
    f.client.getCheckoutSessionPageFromStripe(f.ctx, f.opts),
  ).rejects.toBe(failure);
});
