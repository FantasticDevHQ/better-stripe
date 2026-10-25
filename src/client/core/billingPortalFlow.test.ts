import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { BetterStripe, type BetterStripeComponent } from "../index.js";
import type { RunCtx } from "../helpers.js";
import type {
  BillingPortalSubscriptionUpdateFlow,
  CreateBillingPortalSessionOptions,
} from "./accountLinks.js";

const ctx = {} as RunCtx;
const flowData = {
  type: "subscription_update_confirm",
  subscription_update_confirm: {
    subscription: "sub_original",
    items: [{ id: "si_original", price: "price_target" }],
  },
  after_completion: {
    type: "redirect",
    redirect: { return_url: "https://host.example/billing/confirmed" },
  },
} satisfies BillingPortalSubscriptionUpdateFlow;

function fixture(connectedAccountId?: string) {
  const subscription = {
    object: "subscription",
    id: "sub_original",
    customer_account: "acct_customer",
    items: {
      has_more: false,
      data: [{ id: "si_original", price: { id: "price_current" } }],
    },
  };
  const retrieve = vi.fn().mockResolvedValue(subscription);
  const create = vi
    .fn()
    .mockResolvedValue({ url: "https://billing.stripe.test" });
  class Client extends BetterStripe {
    protected stripe() {
      return {
        subscriptions: { retrieve },
        billingPortal: { sessions: { create } },
      } as unknown as Stripe;
    }
  }
  const client = new Client({} as BetterStripeComponent);
  const options = {
    stripeAccountId: "acct_customer",
    connectedAccountId,
    configurationId: "bpc_policy",
    returnUrl: "https://host.example/billing",
    flowData,
  } satisfies CreateBillingPortalSessionOptions;
  return { client, options, subscription, retrieve, create };
}

describe("targeted Billing Portal subscription confirmation", () => {
  it.each([undefined, "acct_connected"])(
    "retains exact subscription/item/price and completion routing in scope %s",
    async (connectedAccountId) => {
      const f = fixture(connectedAccountId);
      expect(await f.client.createBillingPortalSession(ctx, f.options)).toEqual(
        {
          url: "https://billing.stripe.test",
        },
      );
      expect(f.retrieve.mock.calls).toEqual([
        connectedAccountId
          ? ["sub_original", {}, { stripeAccount: connectedAccountId }]
          : ["sub_original"],
      ]);
      const params = {
        customer_account: "acct_customer",
        configuration: "bpc_policy",
        return_url: "https://host.example/billing",
        flow_data: flowData,
      };
      expect(f.create.mock.calls).toEqual([
        connectedAccountId
          ? [params, { stripeAccount: connectedAccountId }]
          : [params],
      ]);
    },
  );

  it.each([
    { id: "sub_other" },
    { customer_account: "acct_other" },
    { customer_account: null },
    { items: { has_more: false, data: [{ id: "si_other" }] } },
    {
      items: {
        has_more: false,
        data: [{ id: "si_original" }, { id: "si_original" }],
      },
    },
  ])(
    "denies mismatched or ambiguous original subscription: %j",
    async (fields) => {
      const f = fixture();
      f.retrieve.mockResolvedValue({ ...f.subscription, ...fields });
      await expect(
        f.client.createBillingPortalSession(ctx, f.options),
      ).rejects.toThrow();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  // Original recovered success stub is preserved separately: the provider disallows multi-item updates.
  it("rejects a multi-item subscription instead of silently selecting its first item", async () => {
    const f = fixture();
    f.retrieve.mockResolvedValue({
      ...f.subscription,
      items: {
        has_more: false,
        data: [{ id: "si_unrelated" }, { id: "si_original" }],
      },
    });
    await expect(
      f.client.createBillingPortalSession(ctx, f.options),
    ).rejects.toThrow();
    expect(f.retrieve).toHaveBeenCalledExactlyOnceWith("sub_original");
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([
    null,
    true,
    [],
    "subscription_update_confirm",
    { ...flowData, type: "subscription_update" },
    {
      ...flowData,
      subscription_update_confirm: { subscription: "sub_original", items: [] },
    },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: "sub_original",
        items: [{ id: "si_original", price: "prod_wrong" }],
      },
    },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: "sub_original",
        items: [
          { id: "si_original", price: "price_target" },
          { id: "si_other", price: "price_other" },
        ],
      },
    },
    {
      ...flowData,
      after_completion: {
        type: "redirect",
        redirect: { return_url: "javascript:alert(1)" },
      },
    },
    { ...flowData, unknownPolicy: true },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: 42,
        items: [{ id: "si_original", price: "price_target" }],
      },
    },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: "sub_original",
        items: [{ id: false, price: "price_target" }],
      },
    },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: "sub_original",
        items: [
          { id: "si_original", price: "price_target", unknownPolicy: true },
        ],
      },
    },
    {
      ...flowData,
      after_completion: { type: "redirect", redirect: { return_url: 42 } },
    },
  ])(
    "rejects unsupported input before provider dispatch: %j",
    async (untrusted) => {
      const f = fixture();
      const options = {
        ...f.options,
        flowData: untrusted,
      } as CreateBillingPortalSessionOptions;
      await expect(
        f.client.createBillingPortalSession(ctx, options),
      ).rejects.toThrow();
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    0,
    -1,
    1.5,
    "2",
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects an invalid target quantity before dispatch: %j",
    async (quantity) => {
      const f = fixture();
      const options = {
        ...f.options,
        flowData: {
          ...flowData,
          subscription_update_confirm: {
            subscription: "sub_original",
            items: [{ id: "si_original", price: "price_target", quantity }],
          },
        },
      } as CreateBillingPortalSessionOptions;
      await expect(
        f.client.createBillingPortalSession(ctx, options),
      ).rejects.toThrow();
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2, Number.MAX_SAFE_INTEGER])(
    "forwards an explicit positive integer target quantity: %j",
    async (quantity) => {
      const f = fixture();
      const requested: BillingPortalSubscriptionUpdateFlow = {
        ...flowData,
        subscription_update_confirm: {
          subscription: "sub_original",
          items: [{ id: "si_original", price: "price_target", quantity }],
        },
      };
      await f.client.createBillingPortalSession(ctx, {
        ...f.options,
        flowData: requested,
      });
      expect(f.create.mock.calls[0]?.[0].flow_data).toEqual(requested);
    },
  );

  it("rejects a partial item page even when the selected item is present", async () => {
    const f = fixture();
    f.retrieve.mockResolvedValue({
      ...f.subscription,
      items: { ...f.subscription.items, has_more: true },
    });
    await expect(
      f.client.createBillingPortalSession(ctx, f.options),
    ).rejects.toThrow();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("retains the authorized scalar snapshot while the original subscription read awaits", async () => {
    const f = fixture("acct_connected");
    const options: CreateBillingPortalSessionOptions = {
      ...f.options,
      flowData: {
        ...flowData,
        subscription_update_confirm: {
          subscription: "sub_original",
          items: [{ id: "si_original", price: "price_target" }],
        },
      },
    };
    let release!: (value: typeof f.subscription) => void;
    f.retrieve.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.client.createBillingPortalSession(ctx, options);
    options.stripeAccountId = "acct_changed";
    options.connectedAccountId = "acct_changed";
    options.returnUrl = "https://untrusted.example/changed";
    options.flowData!.subscription_update_confirm.items[0].price =
      "price_changed";
    release(f.subscription);
    await pending;
    expect(f.create.mock.calls).toEqual([
      [
        {
          customer_account: "acct_customer",
          configuration: "bpc_policy",
          return_url: "https://host.example/billing",
          flow_data: flowData,
        },
        { stripeAccount: "acct_connected" },
      ],
    ]);
  });

  it("preserves ordinary configured sessions without a subscription lookup", async () => {
    const f = fixture();
    const { flowData: _flowData, ...ordinary } = f.options;
    await f.client.createBillingPortalSession(ctx, ordinary);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.create.mock.calls).toEqual([
      [
        {
          customer_account: ordinary.stripeAccountId,
          return_url: ordinary.returnUrl,
          configuration: ordinary.configurationId,
        },
      ],
    ]);
  });

  it("does not fall back to an account-wide session after a scoped read fails", async () => {
    const f = fixture("acct_connected");
    f.retrieve.mockRejectedValue(
      new Error("Original subscription unavailable"),
    );
    await expect(
      f.client.createBillingPortalSession(ctx, f.options),
    ).rejects.toThrow();
    expect(f.retrieve).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled();
  });
});
