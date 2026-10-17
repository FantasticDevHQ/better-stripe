import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import { api } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";

vi.mock("../stripe/helpers", () => ({
  stripe: {
    addMerchantConfiguration: vi.fn(),
    addRecipientConfiguration: vi.fn(),
    updateV2Account: vi.fn(),
    syncAllAccounts: vi.fn(),
  },
}));
beforeEach(() => vi.resetAllMocks());

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
    expect(await t.action(ref, { stripeAccountId: "acct_owner" })).toEqual({
      success: true,
    });
    expect(method).toHaveBeenCalledWith(expect.anything(), {
      stripeAccountId: "acct_owner",
    });
    expect(stripe.syncAllAccounts).not.toHaveBeenCalled();
    expect(stripe.updateV2Account).not.toHaveBeenCalled();
  },
);

it("propagates a component rejection without reporting success or refreshing unrelated accounts", async () => {
  vi.mocked(stripe.addRecipientConfiguration).mockRejectedValue(
    new Error("Account ownership mismatch"),
  );
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.marketplace.accountActions.addMarketplaceRecipientConfig, {
      stripeAccountId: "acct_foreign",
    }),
  ).rejects.toThrow("Account ownership mismatch");
  expect(stripe.syncAllAccounts).not.toHaveBeenCalled();
});
