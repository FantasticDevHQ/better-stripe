import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modules } from "../../test";
import { api } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";

vi.mock("../stripe/helpers", () => ({
  stripe: {
    addCustomerConfiguration: vi.fn(),
    addMerchantConfiguration: vi.fn(),
    addRecipientConfiguration: vi.fn(),
    createCheckoutSession: vi.fn(),
    getAccountByUserId: vi.fn(),
    getAccountByStripeId: vi.fn(),
    updateV2Account: vi.fn(),
    syncAllAccounts: vi.fn(),
  },
}));

// The acting persona ("owner") is linked to acct_owner; nobody else is.
const OWNER = { userId: "owner", stripeAccountId: "acct_owner" };
function linkOwner() {
  vi.mocked(stripe.getAccountByUserId).mockImplementation((async (
    _ctx: unknown,
    args: { userId: string },
  ) =>
    args.userId === OWNER.userId
      ? { stripeAccountId: OWNER.stripeAccountId }
      : null) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  linkOwner();
});

it.each([
  ["merchant", api.marketplace.accountActions.addMarketplaceMerchantConfig],
  ["recipient", api.marketplace.accountActions.addMarketplaceRecipientConfig],
] as const)(
  "persists only the requested %s account through the component helper",
  async (kind, ref) => {
    const method =
      kind === "merchant"
        ? stripe.addMerchantConfiguration
        : stripe.addRecipientConfiguration;
    vi.mocked(method).mockResolvedValue({
      success: true,
      appliedConfigurations: [kind],
    });
    const t = convexTest(schema, modules);
    expect(await t.action(ref, OWNER)).toEqual({ success: true });
    expect(method).toHaveBeenCalledWith(expect.anything(), {
      stripeAccountId: "acct_owner",
    });
    expect(stripe.syncAllAccounts).not.toHaveBeenCalled();
    expect(stripe.updateV2Account).not.toHaveBeenCalled();
  },
);

it("adds the customer configuration to the caller's own account", async () => {
  vi.mocked(stripe.addCustomerConfiguration).mockResolvedValue({
    success: true,
    appliedConfigurations: ["recipient", "customer"],
  });
  const t = convexTest(schema, modules);
  expect(
    await t.action(
      api.marketplace.accountActions.addMarketplaceCustomerConfig,
      OWNER,
    ),
  ).toEqual({
    success: true,
    appliedConfigurations: ["recipient", "customer"],
  });
  expect(stripe.addCustomerConfiguration).toHaveBeenCalledWith(
    expect.anything(),
    { stripeAccountId: "acct_owner" },
  );
});

it("propagates a component rejection without reporting success or refreshing unrelated accounts", async () => {
  vi.mocked(stripe.addRecipientConfiguration).mockRejectedValue(
    new Error("Account ownership mismatch"),
  );
  const t = convexTest(schema, modules);
  await expect(
    t.action(
      api.marketplace.accountActions.addMarketplaceRecipientConfig,
      OWNER,
    ),
  ).rejects.toThrow("Account ownership mismatch");
  expect(stripe.syncAllAccounts).not.toHaveBeenCalled();
});

describe("foreign-account refusal", () => {
  const configActions = [
    [
      "customer",
      api.marketplace.accountActions.addMarketplaceCustomerConfig,
      () => stripe.addCustomerConfiguration,
    ],
    [
      "recipient",
      api.marketplace.accountActions.addMarketplaceRecipientConfig,
      () => stripe.addRecipientConfiguration,
    ],
    [
      "merchant",
      api.marketplace.accountActions.addMarketplaceMerchantConfig,
      () => stripe.addMerchantConfiguration,
    ],
  ] as const;

  it.each(configActions)(
    "refuses to add the %s configuration to an account the caller does not own",
    async (_kind, ref, method) => {
      const t = convexTest(schema, modules);
      await expect(
        t.action(ref, { userId: "owner", stripeAccountId: "acct_foreign" }),
      ).rejects.toThrow(/Account not found for this user/);
      await expect(
        t.action(ref, { userId: "stranger", stripeAccountId: "acct_owner" }),
      ).rejects.toThrow(/Account not found for this user/);
      expect(method()).not.toHaveBeenCalled();
    },
  );

  it("refuses a self-purchase checkout billed to someone else's account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(
        api.marketplace.accountActions.createMarketplaceSelfPurchaseCheckout,
        {
          userId: "owner",
          stripeAccountId: "acct_foreign",
          stripePriceId: "price_1",
          returnUrl: "https://example.com/return",
        },
      ),
    ).rejects.toThrow(/Account not found for this user/);
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates the self-purchase checkout for the caller's own account", async () => {
    vi.mocked(stripe.createCheckoutSession).mockResolvedValue({
      stripeSessionId: "cs_test_1",
      url: "https://checkout.stripe.com/c/cs_test_1",
    } as never);
    const t = convexTest(schema, modules);
    await t.action(
      api.marketplace.accountActions.createMarketplaceSelfPurchaseCheckout,
      {
        ...OWNER,
        stripePriceId: "price_1",
        returnUrl: "https://example.com/return",
      },
    );
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "owner", accountId: "acct_owner" }),
    );
  });
});
