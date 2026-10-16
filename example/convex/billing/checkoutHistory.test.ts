import { afterEach, expect, it, vi } from "vitest";
import { stripe } from "../stripe/helpers";
import { readBuyerCheckoutSessionPage } from "./checkoutHistory";

afterEach(() => vi.restoreAllMocks());

it("derives Checkout scope from the server-owned personal buyer mapping", async () => {
  const ctx = {} as never;
  vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue({
    userId: "buyer",
    stripeAccountId: "acct_buyer",
  } as never);
  const page = vi
    .spyOn(stripe, "getCheckoutSessionPageFromStripe")
    .mockResolvedValue({ page: [], hasMore: false, continueCursor: null });
  await expect(
    readBuyerCheckoutSessionPage(ctx, "buyer", {
      customerAccount: "acct_foreign",
      limit: 10,
    } as never),
  ).resolves.toEqual({ page: [], hasMore: false, continueCursor: null });
  expect(page).toHaveBeenCalledExactlyOnceWith(ctx, {
    customerAccount: "acct_buyer",
    limit: 10,
  });
});

it.each([
  null,
  { userId: "foreign", stripeAccountId: "acct_foreign" },
  { userId: "buyer", orgId: "organization", stripeAccountId: "acct_org" },
])(
  "denies missing, foreign or organization-owned mappings %#",
  async (mapping) => {
    vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue(mapping as never);
    const page = vi.spyOn(stripe, "getCheckoutSessionPageFromStripe");
    await expect(
      readBuyerCheckoutSessionPage({} as never, "buyer", {}),
    ).rejects.toThrow(/buyer account/i);
    expect(page).not.toHaveBeenCalled();
  },
);

it("requires a trusted server buyer identity before any account lookup", async () => {
  const account = vi.spyOn(stripe, "getAccountByUserId");
  await expect(
    readBuyerCheckoutSessionPage({} as never, " ", {}),
  ).rejects.toThrow(/buyer account/i);
  expect(account).not.toHaveBeenCalled();
});

it("leaves provider failure unresolved instead of manufacturing empty history", async () => {
  vi.spyOn(stripe, "getAccountByUserId").mockResolvedValue({
    userId: "buyer",
    stripeAccountId: "acct_buyer",
  } as never);
  const error = new Error("provider unavailable");
  vi.spyOn(stripe, "getCheckoutSessionPageFromStripe").mockRejectedValue(error);
  await expect(
    readBuyerCheckoutSessionPage({} as never, "buyer", {}),
  ).rejects.toBe(error);
});
