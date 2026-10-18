import { expect, it } from "vitest";
import type Stripe from "stripe";
import { fixture } from "../usage/subscriptionTransport.fixtures.js";
import { request } from "../usage/subscription.fixtures.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import type { WebhookContext } from "./helpers.js";
import { syncManagedUsageEvent } from "./usageSubscriptions.js";
const ref = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    livemode: false,
  },
  requestId: "signup1",
};
it("refreshes managed native state rather than trusting an old subscription payload", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  const event = {
    type: "customer.subscription.updated",
    livemode: false,
    data: { object: { ...f.state.native, status: "past_due" } },
  } as unknown as Stripe.Event;
  await f.t.action((ctx) =>
    syncManagedUsageEvent(
      {
        ctx,
        component: f.component,
        stripe: f.stripe,
        webhookSecret: "whsec_fixture",
      } as WebhookContext,
      event,
    ),
  );
  expect(
    await f.t.query((ctx) => client.usage.getSubscription(ctx as RunCtx, ref)),
  ).toMatchObject({ status: "available", value: { status: "active" } });
  f.state.missingNative = true;
  await expect(
    f.t.action((ctx) =>
      syncManagedUsageEvent(
        {
          ctx,
          component: f.component,
          stripe: f.stripe,
          webhookSecret: "whsec_fixture",
        } as WebhookContext,
        event,
      ),
    ),
  ).rejects.toThrow("Native usage lifecycle observation unavailable");
});
it("records managed paid invoice observations without treating paid status as new cash", async () => {
  const f = fixture(),
    client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    };
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, options),
  );
  const event = {
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: "in_closeout",
        parent: {
          subscription_details: {
            subscription: "sub_calls",
            metadata: f.state.native!.metadata,
          },
        },
      },
    },
  } as unknown as Stripe.Event;
  await f.t.action((ctx) =>
    syncManagedUsageEvent(
      {
        ctx,
        component: f.component,
        stripe: f.stripe,
        webhookSecret: "whsec_fixture",
      } as WebhookContext,
      event,
    ),
  );
  const history = await f.t.query((ctx) =>
    client.usage.readSubscriptionHistory(ctx as RunCtx, {
      ...ref,
      kind: "invoice",
      limit: 10,
      cursor: null,
    }),
  );
  expect(history.records[0].observation).toMatchObject([
    {
      observation: {
        status: "available",
        value: { status: "paid", paymentEvidence: "not_resolved" },
      },
    },
  ]);
  expect(
    f.calls
      .filter((call) => call.path.includes("/invoices/"))
      .every((call) => call.method === "GET"),
  ).toBe(true);
});
it("leaves existing fixed-price flows untouched and rejects foreign managed event context", async () => {
  const f = fixture();
  await f.t.action((ctx) =>
    syncManagedUsageEvent(
      {
        ctx,
        component: f.component,
        stripe: f.stripe,
        webhookSecret: "whsec_fixture",
      } as WebhookContext,
      {
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: { id: "sub_fixed", metadata: {} } },
      } as unknown as Stripe.Event,
    ),
  );
  expect(f.calls).toHaveLength(0);
  const client = new BetterStripe(f.component);
  await f.t.action((ctx) =>
    client.usage.ensureSubscription(ctx as RunCtx, request, {
      stripeSecretKey: "sk_test_subscription",
      httpClient: f.httpClient,
    }),
  );
  await expect(
    f.t.action((ctx) =>
      syncManagedUsageEvent(
        {
          ctx,
          component: f.component,
          stripe: f.stripe,
          webhookSecret: "whsec_fixture",
        } as WebhookContext,
        {
          type: "customer.subscription.updated",
          account: "acct_foreign",
          livemode: false,
          data: { object: f.state.native },
        } as unknown as Stripe.Event,
      ),
    ),
  ).rejects.toThrow("Native usage lifecycle observation unavailable");
});
