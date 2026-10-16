import { afterEach, expect, it, vi } from "vitest";
import { stripe } from "../stripe/helpers";
import { readBuyerInvoicePage } from "./invoiceHistory";

afterEach(() => vi.restoreAllMocks());
it("derives provider invoice scope from the retained buyer mapping", async () => {
  const ctx = {} as never;
  const account = vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue({
    userId: "buyer",
    stripeAccountId: "acct_buyer",
  } as never);
  const page = vi
    .spyOn(stripe, "getInvoicePageFromStripe")
    .mockResolvedValue({ page: [], hasMore: false, continueCursor: null });
  const options = { customerAccount: "acct_foreign", limit: 10 } as never;
  await expect(readBuyerInvoicePage(ctx, "buyer", options)).resolves.toEqual({
    page: [],
    hasMore: false,
    continueCursor: null,
  });
  expect(account).toHaveBeenCalledWith(ctx, { userId: "buyer" });
  expect(page).toHaveBeenCalledWith(ctx, {
    customerAccount: "acct_buyer",
    limit: 10,
  });
});
it.each([
  null,
  { userId: "other", stripeAccountId: "acct_foreign" },
  { userId: "buyer", orgId: "org", stripeAccountId: "acct_organization" },
])(
  "rejects missing or mismatched personal buyer mappings %#",
  async (mapping) => {
    vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue(mapping as never);
    const page = vi.spyOn(stripe, "getInvoicePageFromStripe");
    await expect(
      readBuyerInvoicePage({} as never, "buyer", {}),
    ).rejects.toThrow(/buyer account/i);
    expect(page).not.toHaveBeenCalled();
  },
);
