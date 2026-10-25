import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  BetterStripe,
  prepareBillingPortalSessionRequestIdentity,
  type BetterStripeComponent,
} from "../index.js";
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

describe("caller-owned Billing Portal request identity", () => {
  it.each([undefined, "acct_connected"])(
    "replays an ordinary configured request identity in scope %s",
    async (connectedAccountId) => {
      const f = fixture(connectedAccountId);
      const { flowData: _flowData, ...ordinary } = f.options;
      const requestIdentity = prepareBillingPortalSessionRequestIdentity(
        ordinary,
        "portal:ordinary",
      );
      await f.client.createBillingPortalSession(ctx, {
        ...ordinary,
        requestIdentity,
      });
      await f.client.createBillingPortalSession(ctx, {
        ...ordinary,
        requestIdentity: JSON.parse(JSON.stringify(requestIdentity)),
      });
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(f.create).toHaveBeenCalledTimes(2);
      expect(f.create.mock.calls[0]).toEqual([
        {
          customer_account: "acct_customer",
          configuration: "bpc_policy",
          return_url: ordinary.returnUrl,
        },
        {
          ...(connectedAccountId ? { stripeAccount: connectedAccountId } : {}),
          maxNetworkRetries: 0,
          idempotencyKey: "portal:ordinary",
        },
      ]);
      expect(f.create.mock.calls[1]).toEqual(f.create.mock.calls[0]);
    },
  );
  it("rejects an ordinary request's mismatched retained binding before provider I/O", async () => {
    const f = fixture();
    const { flowData: _flowData, ...ordinary } = f.options;
    await expect(
      f.client.createBillingPortalSession(ctx, {
        ...ordinary,
        requestIdentity: {
          key: "portal:original",
          binding: "different-request",
        },
      } as CreateBillingPortalSessionOptions),
    ).rejects.toThrow();
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([undefined, "acct_connected"])(
    "retains one caller key and complete targeted request in scope %s",
    async (connectedAccountId) => {
      const f = fixture(connectedAccountId);
      const identity = prepareBillingPortalSessionRequestIdentity(
        f.options,
        "portal:original",
      );
      const retained = JSON.parse(JSON.stringify(identity));
      const responses = await Promise.all([
        f.client.createBillingPortalSession(ctx, {
          ...f.options,
          requestIdentity: retained,
        }),
        f.client.createBillingPortalSession(ctx, {
          ...f.options,
          requestIdentity: retained,
        }),
      ]);
      expect(responses).toEqual([
        { url: "https://billing.stripe.test" },
        { url: "https://billing.stripe.test" },
      ]);
      expect(f.create).toHaveBeenCalledTimes(2);
      for (const call of f.create.mock.calls)
        expect(call[1]).toEqual({
          ...(connectedAccountId ? { stripeAccount: connectedAccountId } : {}),
          maxNetworkRetries: 0,
          idempotencyKey: "portal:original",
        });
      for (const call of f.retrieve.mock.calls)
        expect(call).toEqual([
          "sub_original",
          {},
          {
            ...(connectedAccountId
              ? { stripeAccount: connectedAccountId }
              : {}),
            maxNetworkRetries: 0,
          },
        ]);
      expect(f.create.mock.calls[0]?.[0]).toEqual(f.create.mock.calls[1]?.[0]);
    },
  );

  const changes: Array<
    [string, (options: CreateBillingPortalSessionOptions) => void]
  > = [
    [
      "customer account",
      (o) => {
        o.stripeAccountId = "acct_other";
      },
    ],
    [
      "connected account",
      (o) => {
        o.connectedAccountId = "acct_other";
      },
    ],
    [
      "platform scope",
      (o) => {
        o.connectedAccountId = undefined;
      },
    ],
    [
      "configuration",
      (o) => {
        o.configurationId = "bpc_other";
      },
    ],
    [
      "default configuration",
      (o) => {
        o.configurationId = undefined;
      },
    ],
    [
      "return routing",
      (o) => {
        o.returnUrl = "https://host.example/other";
      },
    ],
    [
      "subscription",
      (o) => {
        o.flowData!.subscription_update_confirm.subscription = "sub_other";
      },
    ],
    [
      "item",
      (o) => {
        o.flowData!.subscription_update_confirm.items[0].id = "si_other";
      },
    ],
    [
      "price",
      (o) => {
        o.flowData!.subscription_update_confirm.items[0].price = "price_other";
      },
    ],
    [
      "quantity",
      (o) => {
        o.flowData!.subscription_update_confirm.items[0].quantity = 2;
      },
    ],
    [
      "completion routing",
      (o) => {
        o.flowData!.after_completion!.redirect.return_url =
          "https://host.example/other";
      },
    ],
    [
      "default completion",
      (o) => {
        o.flowData!.after_completion = undefined;
      },
    ],
    [
      "account-wide flow",
      (o) => {
        o.flowData = undefined;
      },
    ],
  ];
  it.each(changes)(
    "rejects a changed %s under the retained identity before I/O",
    async (_name, change) => {
      const f = fixture("acct_connected");
      const original = structuredClone(f.options);
      const requestIdentity = prepareBillingPortalSessionRequestIdentity(
        original,
        "portal:immutable",
      );
      const changed: CreateBillingPortalSessionOptions =
        structuredClone(original);
      change(changed);
      await expect(
        f.client.createBillingPortalSession(ctx, {
          ...changed,
          requestIdentity,
        }),
      ).rejects.toMatchObject({ data: { code: "INVALID_CONFIGURATION" } });
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it("normalizes supported object ordering and omitted optional fields", async () => {
    const f = fixture();
    const first = prepareBillingPortalSessionRequestIdentity(
      f.options,
      "portal:normalized",
    );
    const reordered = {
      flowData: {
        after_completion: flowData.after_completion,
        subscription_update_confirm: {
          items: [
            { price: "price_target", quantity: undefined, id: "si_original" },
          ],
          subscription: "sub_original",
        },
        type: "subscription_update_confirm" as const,
      },
      returnUrl: f.options.returnUrl,
      stripeAccountId: f.options.stripeAccountId,
      configurationId: f.options.configurationId,
    } satisfies CreateBillingPortalSessionOptions;
    expect(
      prepareBillingPortalSessionRequestIdentity(reordered, first.key),
    ).toEqual(first);
    await f.client.createBillingPortalSession(ctx, {
      ...reordered,
      requestIdentity: first,
    });
    expect(f.create).toHaveBeenCalledOnce();
  });

  it.each([
    "",
    " ",
    "bad\nkey",
    "bad\rkey",
    "x".repeat(256),
    null,
    42,
    undefined,
  ])("rejects invalid caller key %j", (key) => {
    const f = fixture();
    expect(() =>
      prepareBillingPortalSessionRequestIdentity(f.options, key as string),
    ).toThrow();
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    "key",
    {},
    { key: "key", binding: "wrong", extra: true },
    { key: 42, binding: "wrong" },
    { key: "key", binding: 42 },
    { key: "key", binding: "better-stripe:billing-portal:v2:{}" },
  ])(
    "rejects malformed or unsupported identity %j before dispatch",
    async (requestIdentity) => {
      const f = fixture();
      const { flowData: _flowData, ...ordinary } = f.options;
      await expect(
        f.client.createBillingPortalSession(ctx, {
          ...ordinary,
          requestIdentity,
        } as CreateBillingPortalSessionOptions),
      ).rejects.toThrow();
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      type: "StripeIdempotencyError",
      code: "idempotency_key_in_use",
      message: "Request conflicts with the original parameters",
    },
    {
      type: "StripeConnectionError",
      code: "ETIMEDOUT",
      message: "Outcome unknown",
    },
  ])(
    "keeps provider $type visible after one keyed attempt",
    async (failure) => {
      const f = fixture("acct_connected");
      const requestIdentity = prepareBillingPortalSessionRequestIdentity(
        f.options,
        "portal:unknown",
      );
      f.create.mockRejectedValue(failure);
      await expect(
        f.client.createBillingPortalSession(ctx, {
          ...f.options,
          requestIdentity,
        }),
      ).rejects.toMatchObject({
        data: { code: "STRIPE_API_ERROR", stripeError: failure },
      });
      expect(f.create).toHaveBeenCalledTimes(1);
      expect(f.create.mock.calls[0]?.[1]).toEqual({
        stripeAccount: "acct_connected",
        maxNetworkRetries: 0,
        idempotencyKey: "portal:unknown",
      });
    },
  );

  it("snapshots the caller identity and request before awaiting provider reads", async () => {
    const f = fixture("acct_connected");
    const options: CreateBillingPortalSessionOptions = structuredClone(
      f.options,
    );
    options.requestIdentity = prepareBillingPortalSessionRequestIdentity(
      options,
      "portal:snapshot",
    );
    let release!: (value: typeof f.subscription) => void;
    f.retrieve.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.client.createBillingPortalSession(ctx, options);
    options.requestIdentity.key = "rotated";
    options.requestIdentity.binding = "changed";
    options.connectedAccountId = "acct_changed";
    options.flowData!.subscription_update_confirm.items[0].price =
      "price_changed";
    release(f.subscription);
    await pending;
    expect(f.create.mock.calls[0]?.[1]).toEqual({
      stripeAccount: "acct_connected",
      maxNetworkRetries: 0,
      idempotencyKey: "portal:snapshot",
    });
    expect(f.create.mock.calls[0]?.[0].flow_data).toEqual(flowData);
  });

  it("keeps ordinary omission compatible while disabling automatic creation retries", async () => {
    const f = fixture();
    const { flowData: _flowData, ...ordinary } = f.options;
    await f.client.createBillingPortalSession(ctx, ordinary);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledExactlyOnceWith(
      {
        customer_account: "acct_customer",
        return_url: ordinary.returnUrl,
        configuration: "bpc_policy",
      },
      { maxNetworkRetries: 0 },
    );
  });
});
