// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
const calls = vi.hoisted(() => ({
  retrieve: vi.fn(),
  configuration: vi.fn(),
  session: vi.fn(),
}));
vi.mock("../../stripe/client", () => ({
  getStripeClient: () => ({ subscriptions: { retrieve: calls.retrieve } }),
}));
vi.mock("../../stripe/helpers", () => ({
  stripe: {
    createBillingPortalConfiguration: calls.configuration,
    createBillingPortalSession: calls.session,
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FRONTEND_URL", "http://localhost:5173");
  calls.configuration.mockResolvedValue({ id: "bpc_server_policy" });
  calls.session.mockResolvedValue({
    url: "https://billing.stripe.test/confirmation",
  });
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.test",
      role: "seller",
      stripeAccountId: "acct_seller",
      storePlan: {
        planId: "starter",
        stripeSubscriptionId: "sub_saved",
        status: "active",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  await t.mutation(
    internal.storePlans.billing.internal.mutations.saveCatalogPrice,
    {
      planId: "growth",
      stripeProductId: "prod_catalog",
      stripePriceId: "price_catalog",
    },
  );
  const original = {
    id: "sub_saved",
    customer_account: "acct_seller",
    items: {
      has_more: false,
      data: [
        { id: "si_saved", price: { id: "price_old", product: "prod_catalog" } },
      ],
    },
  };
  calls.retrieve.mockResolvedValue(original);
  const input = {
    sellerId,
    targetPlanId: "growth" as const,
    returnUrl: "http://localhost:5173/seller/plan",
  };
  return { t, input, original };
}
it("derives exact original/customer/item/target/configuration from the server demo persona and catalog", async () => {
  const { t, input } = await setup();
  expect(await t.action(api.storePlans.public.actions.manage, input)).toBe(
    "https://billing.stripe.test/confirmation",
  );
  expect(calls.retrieve).toHaveBeenCalledExactlyOnceWith("sub_saved");
  expect(calls.configuration).toHaveBeenCalledOnce();
  expect(calls.session).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    stripeAccountId: "acct_seller",
    configurationId: "bpc_server_policy",
    returnUrl: input.returnUrl,
    flowData: {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: "sub_saved",
        items: [{ id: "si_saved", price: "price_catalog" }],
      },
      after_completion: {
        type: "redirect",
        redirect: { return_url: input.returnUrl },
      },
    },
  });
});
it.each(["customer", "subscription", "multi-item", "partial"])(
  "rejects %s before any provider configuration/session write",
  async (failure) => {
    const { t, input, original } = await setup();
    calls.retrieve.mockResolvedValue({
      ...original,
      ...(failure === "customer" ? { customer_account: "acct_other" } : {}),
      ...(failure === "subscription" ? { id: "sub_other" } : {}),
      ...(failure === "multi-item"
        ? {
            items: {
              ...original.items,
              data: [...original.items.data, { id: "si_other" }],
            },
          }
        : {}),
      ...(failure === "partial"
        ? { items: { ...original.items, has_more: true } }
        : {}),
    });
    await expect(
      t.action(api.storePlans.public.actions.manage, input),
    ).rejects.toThrow();
    expect(calls.retrieve).toHaveBeenCalledExactlyOnceWith("sub_saved");
    expect(calls.configuration).not.toHaveBeenCalled();
    expect(calls.session).not.toHaveBeenCalled();
  },
);
it.each(["target", "redirect"])(
  "rejects an unapproved %s before any provider request",
  async (failure) => {
    const { t, input } = await setup();
    await expect(
      t.action(api.storePlans.public.actions.manage, {
        ...input,
        ...(failure === "target"
          ? { targetPlanId: "pro" as const }
          : { returnUrl: "https://untrusted.example/return" }),
      }),
    ).rejects.toThrow();
    expect(calls.retrieve).not.toHaveBeenCalled();
    expect(calls.configuration).not.toHaveBeenCalled();
    expect(calls.session).not.toHaveBeenCalled();
  },
);
