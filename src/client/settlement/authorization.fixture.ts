import { BetterStripe } from "../index.js";
import { getStripeClient } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { vi } from "vitest";
import type { SettleSaleOptions } from "./settleSale.js";
const modules = import.meta.glob("../../component/**/*.ts");

export async function authorizationFixture(twoLegs = false) {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const key = `sk_test_qa_settlement_${crypto.randomUUID()}`;
  const sdk = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: key,
  });
  const transfers: Record<string, unknown>[] = [];
  const requests: { method: string; path: string }[] = [];
  let authorized = true;
  let stopAfterFirst = false;
  let failLedger = false;
  let pause: "payment" | "history" | undefined;
  let reached = () => {};
  let release = () => {};
  const reachedRead = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const options: SettleSaleOptions = {
    paymentIntentId: "pi_authorize",
    allocation: {
      gross: 1000,
      currency: "usd",
      processingFee: 60,
      platformNet: 0,
      transfers: twoLegs
        ? [
            {
              destinationAccountId: "acct_creator",
              role: "store",
              amount: 840,
            },
            { destinationAccountId: "acct_other", role: "other", amount: 100 },
          ]
        : [
            {
              destinationAccountId: "acct_creator",
              role: "store",
              amount: 940,
            },
          ],
    },
  };
  vi.spyOn(
    getStripeClient(key).getApiField("httpClient"),
    "makeRequest",
  ).mockImplementation(
    async (_host, _port, requestPath, method, _headers, data) => {
      if (typeof requestPath !== "string" || typeof method !== "string")
        throw new Error("Malformed synthetic transport request");
      const path = new URL(requestPath, "https://qa.invalid").pathname;
      requests.push({ method, path });
      let body: unknown;
      if (method === "GET" && path === "/v1/payment_intents/pi_authorize") {
        if (pause === "payment") {
          pause = undefined;
          reached();
          await released;
        }
        body = {
          id: "pi_authorize",
          status: "succeeded",
          amount_received: 1000,
          currency: "usd",
          metadata: {},
          latest_charge: {
            id: "ch_authorize",
            amount: 1000,
            currency: "usd",
            amount_refunded: 0,
            disputed: false,
            balance_transaction: {
              id: "txn_authorize",
              fee: 60,
              currency: "usd",
            },
          },
        };
      } else if (method === "GET" && path === "/v1/transfers") {
        if (pause === "history") {
          pause = undefined;
          reached();
          await released;
        }
        body = { data: transfers, has_more: false };
      } else if (method === "GET" && path === "/v1/charges/ch_authorize") {
        body = { id: "ch_authorize", created: 1 };
      } else if (method === "POST" && path === "/v1/transfers") {
        const params = new URLSearchParams(
          typeof data === "string" ? data : "",
        );
        body = {
          id: `tr_${transfers.length}`,
          destination: params.get("destination"),
          amount: Number(params.get("amount")),
          currency: params.get("currency"),
          source_transaction: params.get("source_transaction"),
          transfer_group: params.get("transfer_group"),
          metadata: {
            bsRole: params.get("metadata[bsRole]"),
            bsSourceCharge: params.get("metadata[bsSourceCharge]"),
          },
          amount_reversed: 0,
        };
        transfers.push(body as Record<string, unknown>);
        if (stopAfterFirst) authorized = false;
      } else {
        throw new Error("All unlisted provider transport is forbidden");
      }
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toStream: () => {
          throw new Error("Streams forbidden");
        },
        toJSON: async () => structuredClone(body),
      };
    },
  );
  return {
    t,
    sdk,
    options,
    requests,
    transfers,
    reachedRead,
    release,
    pauseRead: (which: "payment" | "history") => {
      pause = which;
    },
    revoke: () => {
      authorized = false;
    },
    allow: () => {
      authorized = true;
      stopAfterFirst = false;
    },
    stopAfterFirst: () => {
      stopAfterFirst = true;
    },
    failLedger: () => {
      failLedger = true;
    },
    authorize: () => {
      if (!authorized) throw new Error("Host settlement authorization denied");
    },
    settle: (input = options) =>
      t.action((ctx) =>
        sdk.settleSale(
          {
            runQuery: ctx.runQuery,
            runMutation: async (reference, ...args) => {
              const path: unknown = Reflect.get(
                reference,
                Symbol.for("toReferencePath"),
              );
              if (
                failLedger &&
                typeof path === "string" &&
                path.endsWith("connect/mutations/upsertTransfer")
              ) {
                failLedger = false;
                throw new Error("Synthetic ledger write failure");
              }
              return ctx.runMutation(reference, ...args);
            },
          },
          input,
        ),
      ),
    reserve: (allocation: SettleSaleOptions["allocation"]) =>
      t.mutation(
        components.betterStripe.settlement.mutations
          .reserveSettlementAllocation,
        {
          ...allocation,
          sourceChargeId: "ch_authorize",
          paymentIntentId: "pi_authorize",
        },
      ),
    allocation: () =>
      t.query(
        components.betterStripe.settlement.queries.getSettlementAllocation,
        { sourceChargeId: "ch_authorize" },
      ),
  };
}
