import { afterEach, expect, it, vi } from "vitest";
import { stripe } from "../stripe/helpers";
import { readBuyerInvoicePaymentPage } from "./invoicePayments";

afterEach(() => vi.restoreAllMocks());
const options = {
  stripeInvoiceId: "in_buyer",
  stripeSubscriptionId: "sub_buyer",
  limit: 10,
  cursor: "continuation",
};
it("binds invoice payment reads to the retained personal buyer mapping", async () => {
  const ctx = {} as never;
  const account = vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue({
    userId: "buyer",
    stripeAccountId: "acct_buyer",
  } as never);
  const page = vi
    .spyOn(stripe, "getInvoicePaymentPageFromStripe")
    .mockResolvedValue({
      scope: {
        stripeInvoiceId: "in_buyer",
        stripeSubscriptionId: "sub_buyer",
        customerAccount: "acct_buyer",
      },
      page: [],
      hasMore: false,
      continueCursor: null,
    });
  await expect(
    readBuyerInvoicePaymentPage(ctx, "buyer", {
      ...options,
      customerAccount: "acct_foreign",
    } as never),
  ).resolves.toEqual({
    scope: {
      stripeInvoiceId: "in_buyer",
      stripeSubscriptionId: "sub_buyer",
      customerAccount: "acct_buyer",
    },
    page: [],
    hasMore: false,
    continueCursor: null,
  });
  expect(account).toHaveBeenCalledWith(ctx, { userId: "buyer" });
  expect(page).toHaveBeenCalledWith(ctx, {
    ...options,
    customerAccount: "acct_buyer",
  });
});
it.each([
  null,
  { userId: "other", stripeAccountId: "acct_foreign" },
  { userId: "buyer", orgId: "org", stripeAccountId: "acct_org" },
])(
  "rejects unavailable or foreign personal buyer mappings %#",
  async (mapping) => {
    vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue(mapping as never);
    const page = vi.spyOn(stripe, "getInvoicePaymentPageFromStripe");
    await expect(
      readBuyerInvoicePaymentPage({} as never, "buyer", options),
    ).rejects.toThrow(/buyer account/i);
    expect(page).not.toHaveBeenCalled();
  },
);
it("rejects empty buyers before mapping or provider reads", async () => {
  const account = vi.spyOn(stripe, "getAccountByUserId");
  await expect(
    readBuyerInvoicePaymentPage({} as never, "  ", options),
  ).rejects.toThrow(/buyer account/i);
  expect(account).not.toHaveBeenCalled();
});
it("propagates provider failure instead of presenting a completed empty page", async () => {
  vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue({
    userId: "buyer",
    stripeAccountId: "acct_buyer",
  } as never);
  const failure = new Error("provider unavailable");
  vi.spyOn(stripe, "getInvoicePaymentPageFromStripe").mockRejectedValue(
    failure,
  );
  await expect(
    readBuyerInvoicePaymentPage({} as never, "buyer", options),
  ).rejects.toBe(failure);
});
