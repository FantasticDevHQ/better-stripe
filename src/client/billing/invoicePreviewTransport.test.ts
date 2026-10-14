import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

it.each([undefined, "2026-09-30.preview"] as const)(
  "uses the configured API version for subscription and preview reads: %s",
  async (version) => {
    const key = `sk_test_invoice_transport_${crypto.randomUUID()}`;
    const bs = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      {
        STRIPE_SECRET_KEY: key,
        stripeApiVersion: version,
      },
    );
    const versions: string[] = [];
    const sdk = getStripeClient(key, version);
    (
      sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
    )._setApiField("httpClient", {
      getClientName: () => "invoice-contract-test",
      makeRequest: async (
        ...[, , path, , headers]: Parameters<
          ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
        >
      ) => {
        versions.push(String(headers["Stripe-Version"]));
        const data = path.includes("/subscriptions/")
          ? {
              id: "sub_test",
              customer_account: "acct_buyer",
              items: { data: [{ current_period_end: 1800000000 }] },
            }
          : {
              id: "in_preview",
              currency: "usd",
              total: 100,
              subtotal: 100,
              amount_due: 100,
              period_start: 1800000000,
              period_end: 1802592000,
              lines: { data: [], has_more: false },
            };
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({}),
          getRawResponse: () => ({}),
          toJSON: async () => data,
          toStream: () => {
            throw new Error("Unexpected stream");
          },
        };
      },
    });
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    } as unknown as RunCtx;
    expect(
      await bs.getUpcomingInvoicePreview(ctx, {
        customerAccount: "acct_buyer",
        stripeSubscriptionId: "sub_test",
      }),
    ).toMatchObject({ total: 100, linesComplete: true });
    expect(versions).toEqual(Array(2).fill(version ?? "2026-09-30.endive"));
    expect(ctx.runQuery).not.toHaveBeenCalled();
  },
);
