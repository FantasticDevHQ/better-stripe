import type Stripe from "stripe";
import { afterEach, expect, it, vi } from "vitest";
import {
  refundContextFixture as fixture,
  refund,
  page,
  expectUnavailable,
} from "../../tests/fixtures/refund-context.js";
afterEach(() => vi.restoreAllMocks());

it("uses captured principal rather than authorized amount for a partial capture", async () => {
  const f = fixture();
  expect(await f.read()).toMatchObject({
    status: "ready",
    capturedAmount: 1000,
    refundedAmount: 0,
    remainingRefundableAmount: 1000,
  });
  expect(f.intentRead).toHaveBeenCalledTimes(1);
  expect(f.chargeRead).toHaveBeenCalledTimes(1);
  expect(f.refundRead).toHaveBeenCalledTimes(1);
});

it.each([
  undefined,
  null,
  {},
  { type: "seller" },
  { type: "seller", accountId: "cus_legacy" },
  { type: "buyer", accountId: "acct_store" },
  { type: "admin", accountId: "acct_store" },
])("rejects malformed actor %j before any lookup", async (actor) => {
  const f = fixture();
  await expect(
    f.readRaw({ stripePaymentIntentId: "pi_one", actor }),
  ).rejects.toThrow(/actor/i);
  expect(f.runQuery).not.toHaveBeenCalled();
  expect(f.intentRead).not.toHaveBeenCalled();
  expect(f.chargeRead).not.toHaveBeenCalled();
  expect(f.refundRead).not.toHaveBeenCalled();
});

it.each(["", " pi_one", "pi_one ", "ch_one", "pi_bad?"])(
  "rejects noncanonical PI %j before any lookup",
  async (stripePaymentIntentId) => {
    const f = fixture();
    await expect(f.read({ ...f.opts, stripePaymentIntentId })).rejects.toThrow(
      /stripePaymentIntentId|canonical/i,
    );
    expect(f.runQuery).not.toHaveBeenCalled();
    expect(f.intentRead).not.toHaveBeenCalled();
  },
);

it.each([0, 1.5, 11, Number.NaN])(
  "rejects invalid history budget %j before lookup",
  async (maxRefundPages) => {
    const f = fixture();
    await expect(f.read({ ...f.opts, maxRefundPages })).rejects.toThrow(
      /maxRefundPages|budget/i,
    );
    expect(f.runQuery).not.toHaveBeenCalled();
    expect(f.intentRead).not.toHaveBeenCalled();
  },
);

it.each(["", " acct_scope", "cus_legacy"])(
  "rejects malformed connected scope %j before lookup",
  async (stripeAccountId) => {
    const f = fixture();
    await expect(f.read({ ...f.opts, stripeAccountId })).rejects.toThrow(
      /stripeAccountId|account/i,
    );
    expect(f.runQuery).not.toHaveBeenCalled();
    expect(f.intentRead).not.toHaveBeenCalled();
  },
);

it.each(["foreign", "affiliate", "other"])(
  "denies %s seller before provider reads",
  async (role) => {
    const f = fixture();
    f.runQuery.mockResolvedValue({
      stripePaymentIntentId: "pi_one",
      accountId: "acct_buyer",
      splitRecipients: [{ destinationAccountId: "acct_store", role }],
      amount: 2000,
      currency: "usd",
    });
    await expect(f.read()).rejects.toThrow(/not authorized|unauthorized/i);
    expect(f.intentRead).not.toHaveBeenCalled();
    expect(f.chargeRead).not.toHaveBeenCalled();
    expect(f.refundRead).not.toHaveBeenCalled();
  },
);

it("allows the original store leg without granting minor legs authority", async () => {
  const f = fixture();
  f.runQuery.mockResolvedValue({
    stripePaymentIntentId: "pi_one",
    accountId: "acct_buyer",
    splitRecipients: [
      { destinationAccountId: "acct_store", role: "store" },
      { destinationAccountId: "acct_affiliate", role: "affiliate" },
    ],
    amount: 2000,
    currency: "usd",
  });
  expect(await f.read()).toMatchObject({
    status: "ready",
    remainingRefundableAmount: 1000,
  });
});

it("requires original component target correlation even for an explicit admin", async () => {
  const f = fixture();
  f.runQuery.mockResolvedValue(null);
  expectUnavailable(await f.read({ ...f.opts, actor: { type: "admin" } }));
  expect(f.intentRead).not.toHaveBeenCalled();
});

it.each([
  { stripePaymentIntentId: "pi_other", accountId: "acct_buyer" },
  { stripePaymentIntentId: "pi_one", accountId: "cus_legacy" },
  { stripePaymentIntentId: "pi_one", accountId: undefined },
])(
  "holds unavailable original target %j before provider lookup",
  async (fields) => {
    const f = fixture();
    f.runQuery.mockResolvedValue({
      ...fields,
      destinationAccountId: "acct_store",
      amount: 2000,
      currency: "usd",
    });
    expectUnavailable(await f.read());
    expect(f.intentRead).not.toHaveBeenCalled();
  },
);

it.each([
  { id: "pi_other" },
  { customer_account: "acct_other" },
  { customer_account: null },
  { status: "processing" as const },
])(
  "holds mismatched or incomplete PI %j before charge lookup",
  async (fields) => {
    const f = fixture();
    f.intentRead.mockResolvedValue({ ...f.payment, ...fields });
    expectUnavailable(await f.read());
    expect(f.chargeRead).not.toHaveBeenCalled();
    expect(f.refundRead).not.toHaveBeenCalled();
  },
);

it.each([
  { id: "ch_other" },
  { payment_intent: "pi_other" },
  { currency: "kwd" },
  { amount_captured: 999 },
  { amount_captured: -1 },
  { amount_captured: 1.5 },
  { amount_captured: Number.MAX_SAFE_INTEGER + 1 },
  { amount: 999 },
  { amount_refunded: -1 },
  { amount_refunded: 1001 },
  { amount_refunded: 1.5 },
  { paid: false },
  { captured: false },
  { disputed: true },
])("holds unsupported original charge %j", async (fields) => {
  const f = fixture();
  f.chargeRead.mockResolvedValue({ ...f.charge, ...fields });
  expectUnavailable(await f.read());
  expect(f.refundRead).not.toHaveBeenCalled();
});

it("does not invent a V2 buyer field on Stripe23 Charge and validates supplied legacy customer correlation", async () => {
  const f = fixture();
  f.intentRead.mockResolvedValue({ ...f.payment, customer: "cus_original" });
  f.chargeRead.mockResolvedValue({ ...f.charge, customer: "cus_other" });
  expectUnavailable(await f.read());
  expect(f.refundRead).not.toHaveBeenCalled();
});

it("keeps connected request scope separate from the original buyer", async () => {
  const f = fixture();
  expect(
    await f.read({ ...f.opts, stripeAccountId: "acct_provider_scope" }),
  ).toMatchObject({ status: "ready", remainingRefundableAmount: 1000 });
  expect(f.intentRead).toHaveBeenCalledWith("pi_one", undefined, {
    stripeAccount: "acct_provider_scope",
  });
  expect(f.chargeRead).toHaveBeenCalledWith("ch_one", undefined, {
    stripeAccount: "acct_provider_scope",
  });
  expect(f.refundRead).toHaveBeenCalledWith(
    { payment_intent: "pi_one", limit: 100 },
    { stripeAccount: "acct_provider_scope" },
  );
});

it("supports a completed partial refund followed by its remaining full refund", async () => {
  const f = fixture();
  f.chargeRead.mockResolvedValue({ ...f.charge, amount_refunded: 200 });
  f.refundRead.mockResolvedValue(page([refund("re_partial", 200)]));
  expect(await f.read()).toMatchObject({
    status: "ready",
    capturedAmount: 1000,
    refundedAmount: 200,
    remainingRefundableAmount: 800,
  });
  f.chargeRead.mockResolvedValue({
    ...f.charge,
    amount_refunded: 1000,
    refunded: true,
  });
  f.refundRead.mockResolvedValue(
    page([refund("re_partial", 200), refund("re_rest", 800)]),
  );
  expect(await f.read()).toMatchObject({
    status: "ready",
    capturedAmount: 1000,
    refundedAmount: 1000,
    remainingRefundableAmount: 0,
  });
});

it.each(["jpy", "kwd", "isk"])(
  "retains exact original %s units",
  async (currency) => {
    const f = fixture();
    f.intentRead.mockResolvedValue({
      ...f.payment,
      currency,
      amount: 1234,
      amount_received: 1234,
    });
    f.chargeRead.mockResolvedValue({
      ...f.charge,
      currency,
      amount: 1234,
      amount_captured: 1234,
      amount_refunded: 234,
    });
    f.runQuery.mockResolvedValue({
      stripePaymentIntentId: "pi_one",
      accountId: "acct_buyer",
      destinationAccountId: "acct_store",
      amount: 1234,
      currency,
    });
    f.refundRead.mockResolvedValue(
      page([{ ...refund("re_units", 234), currency }]),
    );
    expect(await f.read()).toMatchObject({
      status: "ready",
      capturedAmount: 1234,
      refundedAmount: 234,
      remainingRefundableAmount: 1000,
    });
  },
);

it.each(["pending", "requires_action", null, "future_state"])(
  "keeps refund state %j unavailable",
  async (status) => {
    const f = fixture();
    f.chargeRead.mockResolvedValue({ ...f.charge, amount_refunded: 200 });
    f.refundRead.mockResolvedValue(
      page([refund("re_pending", 200, status as Stripe.Refund["status"])]),
    );
    expectUnavailable(await f.read());
  },
);

it.each(["failed", "canceled"])(
  "does not subtract %s refund principal",
  async (status) => {
    const f = fixture();
    f.refundRead.mockResolvedValue(
      page([refund("re_failed", 200, status as Stripe.Refund["status"])]),
    );
    expect(await f.read()).toMatchObject({
      status: "ready",
      refundedAmount: 0,
      remainingRefundableAmount: 1000,
    });
  },
);

it.each([
  { charge: "ch_other" },
  { payment_intent: "pi_other" },
  { currency: "kwd" },
  { amount: -1 },
  { amount: 1.5 },
])("holds inconsistent refund %j", async (fields) => {
  const f = fixture();
  f.refundRead.mockResolvedValue(
    page([{ ...refund("re_bad", 100), ...fields }]),
  );
  expectUnavailable(await f.read());
});

it("does not expose a numeric remainder from inconsistent live counters", async () => {
  const f = fixture();
  f.chargeRead.mockResolvedValue({ ...f.charge, amount_refunded: 500 });
  f.refundRead.mockResolvedValue(page([refund("re_observed", 200)]));
  expectUnavailable(await f.read());
});

it("exhausts bounded pages and preserves the original payment scope", async () => {
  const f = fixture();
  f.chargeRead.mockResolvedValue({
    ...f.charge,
    amount_refunded: 1000,
    refunded: true,
  });
  f.refundRead
    .mockResolvedValueOnce(page([refund("re_first", 400)], true))
    .mockResolvedValueOnce(page([refund("re_last", 600)]));
  expect(await f.read({ ...f.opts, maxRefundPages: 2 })).toMatchObject({
    status: "ready",
    remainingRefundableAmount: 0,
  });
  expect(f.refundRead).toHaveBeenNthCalledWith(
    2,
    { payment_intent: "pi_one", limit: 100, starting_after: "re_first" },
    undefined,
  );
});

it("holds exhausted history rather than returning a partial refundable balance", async () => {
  const f = fixture();
  f.refundRead.mockResolvedValue(page([refund("re_first", 200)], true));
  expectUnavailable(await f.read({ ...f.opts, maxRefundPages: 1 }));
  expect(f.refundRead).toHaveBeenCalledTimes(1);
});

it("holds a nonterminal empty provider page", async () => {
  const f = fixture();
  f.refundRead.mockResolvedValue(page([], true));
  expectUnavailable(await f.read());
  expect(f.refundRead).toHaveBeenCalledTimes(1);
});

it("holds duplicate or nonadvancing provider pages", async () => {
  const f = fixture();
  f.refundRead.mockResolvedValue(page([refund("re_repeated", 200)], true));
  expectUnavailable(await f.read({ ...f.opts, maxRefundPages: 2 }));
  expect(f.refundRead).toHaveBeenCalledTimes(2);
});

it("preserves provider error identity instead of inventing a zero balance", async () => {
  const f = fixture();
  const error = new Error("Fixture provider unavailable");
  f.refundRead.mockRejectedValue(error);
  await expect(f.read()).rejects.toBe(error);
});

it.each([900, 1000])(
  "holds a non-last duplicate across pages at counter %i without silently deduplicating",
  async (amount_refunded) => {
    const f = fixture();
    f.chargeRead.mockResolvedValue({ ...f.charge, amount_refunded });
    f.refundRead
      .mockResolvedValueOnce(
        page([refund("re_a", 100), refund("re_b", 200)], true),
      )
      .mockResolvedValueOnce(page([refund("re_a", 100), refund("re_c", 600)]));
    expectUnavailable(await f.read({ ...f.opts, maxRefundPages: 2 }));
  },
);

it.each([
  { data: null },
  { data: {} },
  { has_more: null },
  { has_more: "false" },
  { object: "refund" },
])("holds malformed refund envelope %j", async (fields) => {
  const f = fixture();
  f.refundRead.mockResolvedValue({
    ...page([]),
    ...fields,
  } as Stripe.Response<Stripe.ApiList<Stripe.Refund>>);
  expectUnavailable(await f.read());
  expect(f.refundRead).toHaveBeenCalledTimes(1);
});

it("holds oversized provider pages instead of processing an unbounded envelope", async () => {
  const f = fixture();
  f.refundRead.mockResolvedValue(
    page(
      Array.from({ length: 101 }, (_, i) =>
        refund(`re_large_${i}`, 0, "failed"),
      ),
    ),
  );
  expectUnavailable(await f.read());
  expect(f.refundRead).toHaveBeenCalledTimes(1);
});
