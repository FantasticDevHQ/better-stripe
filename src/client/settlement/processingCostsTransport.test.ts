import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

it.each([undefined, "2026-09-30.preview"] as const)(
  "paginates using the configured version and connected namespace: %s",
  async (version) => {
    const key = `sk_test_cost_transport_${crypto.randomUUID()}`;
    const bs = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      {
        STRIPE_SECRET_KEY: key,
        stripeApiVersion: version,
      },
    );
    const calls: {
      path: string;
      version: string;
      account: string;
      method: string;
    }[] = [];
    const sdk = getStripeClient(key, version);
    const tx = (id: string, amount: number, fee = 0) => ({
      id,
      amount,
      fee,
      net: amount - fee,
      currency: "usd",
      created: 1800000000,
    });
    const refund = (id: string) => ({
      id,
      amount: 100,
      status: "succeeded",
      currency: "usd",
      charge: "ch_test",
      payment_intent: "pi_test",
      balance_transaction: tx(`txn_${id}`, -100),
    });
    (
      sdk as unknown as { _setApiField: (key: string, value: unknown) => void }
    )._setApiField("httpClient", {
      getClientName: () => "cost-context-contract",
      makeRequest: async (
        ...[, , path, method, headers]: Parameters<
          ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
        >
      ) => {
        calls.push({
          path,
          method,
          version: String(headers["Stripe-Version"]),
          account: String(headers["Stripe-Account"]),
        });
        const next = path.includes("starting_after");
        const data = path.includes("/payment_intents/")
          ? {
              id: "pi_test",
              status: "succeeded",
              currency: "usd",
              amount_received: 10000,
              metadata: {},
              latest_charge: {
                id: "ch_test",
                payment_intent: "pi_test",
                currency: "usd",
                balance_transaction: tx("txn_charge", 10000, 320),
              },
            }
          : path.includes("/refunds")
            ? {
                object: "list",
                url: "/v1/refunds",
                has_more: !next,
                data: [refund(next ? "re_second" : "re_first")],
              }
            : {
                object: "list",
                url: "/v1/disputes",
                has_more: !next,
                data: [
                  {
                    id: next ? "dp_second" : "dp_first",
                    status: "warning_closed",
                    amount: 100,
                    currency: "usd",
                    charge: "ch_test",
                    payment_intent: "pi_test",
                    balance_transactions: [],
                  },
                ],
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
      await bs.getProcessingCostContext(ctx, {
        paymentIntentId: "pi_test",
        stripeAccountId: "acct_connected",
      }),
    ).toMatchObject({
      status: "ready",
      refundedPrincipal: 200,
      refunds: [{ id: "re_first" }, { id: "re_second" }],
      disputes: [{ id: "dp_first" }, { id: "dp_second" }],
    });
    expect(calls).toHaveLength(5);
    expect(
      calls.every(
        (call) =>
          call.method === "GET" &&
          call.version === (version ?? "2026-09-30.endive") &&
          call.account === "acct_connected",
      ),
    ).toBe(true);
    expect(
      calls.filter((call) => call.path.includes("starting_after")),
    ).toHaveLength(2);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  },
);
