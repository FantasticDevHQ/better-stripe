import { modules } from "../../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  createAccount: vi.fn(),
  addRecipientConfiguration: vi.fn(),
  addCustomerConfiguration: vi.fn(),
  updateV2Account: vi.fn(),
  attachPaymentMethod: vi.fn(),
}));
vi.mock("../../stripe/helpers", () => ({ stripe }));

import { api, internal } from "../../_generated/api";
import schema from "../../schema";
afterEach(() => vi.unstubAllEnvs());

describe("marketplace seed account configuration", () => {
  it("sets dashboard and responsibilities when requesting recipient transfers", async () => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_seed");
    stripe.createAccount.mockImplementation(async (_ctx, args) => ({
      stripeAccountId: `acct_${args.userId}`,
    }));
    const t = convexTest(schema, modules);
    await t.mutation(internal.admin.seed.mutations.seedMarketplaceDb, {});
    await t.action(internal.admin.seed.actions.seedMarketplaceAccounts, {});
    const users = await t.query(api.users.queries.list, {});
    for (const user of users.filter((u) => u.role !== "buyer")) {
      expect(stripe.updateV2Account).toHaveBeenCalledWith(expect.anything(), {
        stripeAccountId: user.stripeAccountId,
        updateParams: expect.objectContaining({
          dashboard: "none",
          defaults: expect.objectContaining({
            responsibilities: {
              losses_collector: "application",
              fees_collector: "application",
            },
          }),
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
        }),
      });
      expect(stripe.updateV2Account).toHaveBeenCalledWith(expect.anything(), {
        stripeAccountId: user.stripeAccountId,
        updateParams: expect.objectContaining({
          defaults: {
            profile: { business_url: "https://accessible.stripe.com" },
          },
          identity: expect.objectContaining({
            individual: expect.objectContaining({
              given_name: "Test",
              surname: "Recipient",
              date_of_birth: { day: 1, month: 1, year: 1990 },
              address: expect.objectContaining({
                country: "US",
                postal_code: "94080",
              }),
            }),
          }),
        }),
      });
    }
  });
});
