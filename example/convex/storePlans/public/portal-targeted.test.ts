// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules } from "../../../test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
const calls = vi.hoisted(() => ({
  retrieve: vi.fn(),
  configuration: vi.fn(),
  readConfiguration: vi.fn(),
  session: vi.fn(),
}));
vi.mock("../../stripe/client", () => ({
  getStripeClient: () => ({ subscriptions: { retrieve: calls.retrieve } }),
}));
vi.mock("../../stripe/helpers", () => ({
  stripe: {
    createBillingPortalConfiguration: calls.configuration,
    retrieveBillingPortalConfiguration: calls.readConfiguration,
    createBillingPortalSession: calls.session,
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FRONTEND_URL", "http://localhost:5173");
  vi.stubEnv("STORE_PLAN_PORTAL_CONFIGURATION_ID", "bpc_server_policy");
  calls.readConfiguration.mockResolvedValue({
    id: "bpc_server_policy",
    active: true,
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "always_invoice",
        products: [
          { product: "prod_catalog", prices: ["price_catalog", "price_old"] },
        ],
        schedule_at_period_end: { conditions: [] },
      },
    },
  });
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
  expect(calls.retrieve).toHaveBeenCalledExactlyOnceWith(
    "sub_saved",
    {},
    { maxNetworkRetries: 0 },
  );
  expect(calls.configuration).not.toHaveBeenCalled();
  expect(calls.readConfiguration).toHaveBeenCalledOnce();
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
    expect(calls.retrieve).toHaveBeenCalledExactlyOnceWith(
      "sub_saved",
      {},
      { maxNetworkRetries: 0 },
    );
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

it("prepares a retained identity using reads and a fixed server policy before any portal POST", async () => {
  const { t, input } = await setup();
  const identity = await t.action(api.storePlans.public.actions.prepareManage, {
    ...input,
    key: "portal:retained",
  });
  expect(identity).toMatchObject({
    key: "portal:retained",
    binding: expect.stringContaining("bpc_server_policy"),
  });
  expect(calls.readConfiguration).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    { configurationId: "bpc_server_policy" },
  );
  expect(calls.configuration).not.toHaveBeenCalled();
  expect(calls.session).not.toHaveBeenCalled();
  await t.action(api.storePlans.public.actions.manage, {
    ...input,
    requestIdentity: identity,
  });
  expect(calls.session).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    expect.objectContaining({
      configurationId: "bpc_server_policy",
      requestIdentity: identity,
    }),
  );
});
it.each(["inactive", "configuration", "target", "proration", "deferred"])(
  "rejects a configured policy with an invalid %s before portal creation",
  async (failure) => {
    const { t, input } = await setup();
    const policy = await calls.readConfiguration();
    calls.readConfiguration.mockClear();
    if (failure === "inactive") policy.active = false;
    if (failure === "configuration") policy.id = "bpc_other";
    if (failure === "target") policy.features.subscription_update.products = [];
    if (failure === "proration")
      policy.features.subscription_update.proration_behavior = "none";
    if (failure === "deferred")
      policy.features.subscription_update.schedule_at_period_end.conditions = [
        { type: "increasing_item_amount" },
      ];
    await expect(
      t.action(api.storePlans.public.actions.prepareManage, {
        ...input,
        key: "portal:retained",
      }),
    ).rejects.toThrow("configured portal policy");
    expect(calls.configuration).not.toHaveBeenCalled();
    expect(calls.session).not.toHaveBeenCalled();
  },
);
