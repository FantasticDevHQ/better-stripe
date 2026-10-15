import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it } from "vitest";
import { BetterStripe } from "./index.js";
import { getStripeClient } from "./helpers.js";
import type { Component, RunCtx } from "./helpers.js";
import type { RecoveryGroup } from "./costRecovery.js";
it.each(["2026-09-30.endive", "2026-09-30.preview"] as const)(
  "preserves %s on every SDK page and finds existing items beyond the first page",
  async (version) => {
    const key = `sk_test_recovery_transport_${version}`;
    const sdk = getStripeClient(key, version);
    const group = {
      _id: "group-durable",
      _creationTime: 0,
      accountId: "acct_owner",
      scopeKey: "store",
      currency: "usd",
      groupKey: "in:1",
      sourceKind: "invoice",
      sourceId: "in_1",
      status: "sealed",
      amount: 320,
      pendingOperations: 1,
      maxDebit: 1000,
      maxCredit: 1000,
    } as RecoveryGroup;
    const paths: string[] = [];
    (
      sdk as unknown as { _setApiField(field: string, value: unknown): void }
    )._setApiField("httpClient", {
      getClientName: () => "test",
      makeRequest: async (
        ...[, , path, method, headers]: Parameters<
          ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
        >
      ) => {
        expect(headers["Stripe-Version"]).toBe(version);
        expect(method).toBe("GET");
        paths.push(path);
        const data = path.startsWith("/v1/invoices/")
          ? {
              id: "in_1",
              customer_account: group.accountId,
              currency: "usd",
              status: "draft",
            }
          : path.includes("starting_after=")
            ? {
                object: "list",
                has_more: false,
                data: [
                  {
                    id: "ii_existing",
                    invoice: "in_1",
                    customer_account: group.accountId,
                    currency: "usd",
                    amount: 320,
                    discountable: false,
                    metadata: { bsRecoveryGroup: group._id },
                  },
                ],
              }
            : {
                object: "list",
                has_more: true,
                data: Array.from({ length: 100 }, (_, i) => ({
                  id: `ii_${i}`,
                  metadata: {},
                })),
              };
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({}),
          getRawResponse: () => ({}),
          toJSON: async () => data,
          toStream: () => {
            throw new Error("unexpected stream");
          },
        };
      },
    });
    let bound: string | undefined;
    const ctx = {
      runQuery: async () => group,
      runMutation: async (_ref: unknown, args: { invoiceItemId: string }) => {
        bound = args.invoiceItemId;
        return { ...group, invoiceItemId: bound };
      },
    } as unknown as RunCtx;
    const better = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
      { STRIPE_SECRET_KEY: key, stripeApiVersion: version },
    );
    const receipt = await better.costRecovery.attachInvoice(ctx, {
      accountId: group.accountId,
      scopeKey: group.scopeKey,
      currency: group.currency,
      groupKey: group.groupKey,
    });
    expect(receipt.invoiceItemId).toBe("ii_existing");
    expect(bound).toBe("ii_existing");
    expect(paths).toHaveLength(3);
    expect(paths[2]).toContain("starting_after=ii_99");
    expect(paths[2]).toContain("invoice=in_1");
  },
);
