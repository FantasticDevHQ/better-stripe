// @vitest-environment edge-runtime
import Stripe from "stripe";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "../../component/schema.js";
import { BetterStripe, registerRoutes } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";
import type { WebhookHandlerRefs } from "../types.js";

const component = componentsGeneric().betterStripe as unknown as Component;
const modules = import.meta.glob("../../component/**/*.*s");
const secret = "whsec_synthetic_refund_delivery";
const original = {
  id: "re_delivery",
  object: "refund",
  amount: 250,
  currency: "usd",
  payment_intent: "pi_delivery",
  charge: "ch_delivery",
  status: "pending",
  reason: "requested_by_customer",
  metadata: {},
};

async function signature(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  const hash = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hash}`;
}

function fixture(isRegistered = true) {
  const key = `sk_test_delivery_${crypto.randomUUID()}`;
  let isCallbackFailing = false;
  const callbackStatuses: string[] = [];
  const observe = async (_ctx: object, doc: { status: string }) => {
    if (isCallbackFailing)
      throw new Error("Synthetic application callback failure");
    callbackStatuses.push(doc.status);
  };
  const sdk = new BetterStripe(component, {
    STRIPE_SECRET_KEY: key,
    triggers: { refund: { onCreate: observe, onUpdate: observe } },
  });
  const http = httpRouter();
  registerRoutes(http, component, {
    stripeSecretKey: key,
    webhookSecret: secret,
    ...(isRegistered
      ? {
          webhooks: {
            syncWebhook: makeFunctionReference("refundHost:syncWebhook"),
            asyncWebhook: makeFunctionReference("refundHost:asyncWebhook"),
          } as unknown as WebhookHandlerRefs,
        }
      : {}),
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.ts": () =>
      import("../../component/_generated/server.js"),
    "./http.ts": async () => ({ default: http }),
    "./refundHost.ts": async () => sdk.webhookHandlers(),
  });
  t.registerComponent("betterStripe", schema, modules);
  const stripe = getStripeClient(key, sdk.stripeApiVersion);
  const calls: { path: string; method: string; account?: string }[] = [];
  let current = { ...original };
  let statusCode = 200;
  let isRecoveryEnabled = false;
  let isReversalFailing = false;
  let isResponseLost = false;
  let providerReversed = 0;
  let pausedRead: { started: () => void; resume: Promise<void> } | undefined;
  const reversalRequests: {
    body: string;
    key: string | undefined;
    account: string | undefined;
  }[] = [];
  const slot = stripe as unknown as {
    _setApiField: (key: string, value: unknown) => void;
  };
  slot._setApiField("maxNetworkRetries", 0);
  slot._setApiField("httpClient", {
    getClientName: () => "synthetic-refund-delivery",
    makeRequest: async (
      ...[, , path, method, headers, body]: Parameters<
        ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
      >
    ) => {
      calls.push({
        path,
        method,
        account: headers["Stripe-Account"] as string | undefined,
      });
      let response: object = current;
      let responseCode = statusCode;
      if (method === "GET" && path.startsWith("/v1/refunds/re_delivery")) {
        response = current;
        if (pausedRead) {
          const pending = pausedRead;
          pausedRead = undefined;
          pending.started();
          await pending.resume;
        }
      } else if (
        isRecoveryEnabled &&
        method === "GET" &&
        path === "/v1/charges/ch_delivery"
      ) {
        response = {
          id: "ch_delivery",
          object: "charge",
          amount: 1000,
          currency: "usd",
          payment_intent: "pi_delivery",
        };
        responseCode = 200;
      } else if (
        isRecoveryEnabled &&
        method === "GET" &&
        path.startsWith("/v1/refunds?")
      ) {
        response = { object: "list", data: [current], has_more: false };
        responseCode = 200;
      } else if (
        isRecoveryEnabled &&
        method === "GET" &&
        path === "/v1/transfers/tr_delivery"
      ) {
        response = {
          id: "tr_delivery",
          object: "transfer",
          amount: 1000,
          amount_reversed: providerReversed,
        };
        responseCode = 200;
      } else if (
        isRecoveryEnabled &&
        method === "POST" &&
        path === "/v1/transfers/tr_delivery/reversals"
      ) {
        reversalRequests.push({
          body: String(body),
          key: headers["Idempotency-Key"] as string | undefined,
          account: headers["Stripe-Account"] as string | undefined,
        });
        responseCode = isReversalFailing ? 503 : 200;
        if (!isReversalFailing)
          providerReversed = Number(
            new URLSearchParams(String(body)).get("amount"),
          );
        response = {
          id: "trr_delivery",
          object: "transfer_reversal",
          amount: providerReversed,
        };
        if (isResponseLost) {
          isResponseLost = false;
          throw new Error("Synthetic lost committed reversal response");
        }
      } else throw new Error("Unexpected provider operation");
      return {
        getStatusCode: () => responseCode,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () =>
          responseCode >= 400
            ? {
                error: {
                  type: "api_error",
                  message: "Synthetic current refund unavailable",
                },
              }
            : structuredClone(response),
        toStream: () => {
          throw new Error("Unexpected stream");
        },
      };
    },
  });
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  return {
    t,
    sdk,
    ctx,
    calls,
    callbackStatuses,
    reversalRequests,
    providerReversed: () => providerReversed,
    pauseNextRead: () => {
      let start!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      pausedRead = { started: start, resume };
      return { started, release };
    },
    enableRecovery: () => {
      isRecoveryEnabled = true;
    },
    failReversal: (value: boolean) => {
      isReversalFailing = value;
    },
    loseReversalResponse: () => {
      isResponseLost = true;
    },
    seedLeg: () =>
      t.mutation(component.connect.mutations.upsertTransfer, {
        stripeTransferId: "tr_delivery",
        sourceChargeId: "ch_delivery",
        destinationAccountId: "acct_recipient",
        amount: 1000,
        currency: "usd",
        status: "paid",
        role: "store",
      }),
    failCallback: (value: boolean) => {
      isCallbackFailing = value;
    },
    setRefund: (patch: Partial<typeof original>) => {
      current = { ...original, ...patch };
    },
    set: (status: string, code = 200) => {
      current = { ...original, status };
      statusCode = code;
    },
    row: () => sdk.getRefundByStripeId(ctx, { stripeRefundId: original.id }),
    send: async (
      id: string,
      snapshotStatus = "pending",
      account?: string,
      isValid = true,
      type = "refund.updated",
    ) => {
      const body = JSON.stringify({
        id,
        object: "event",
        type,
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        ...(account ? { account } : {}),
        data: { object: { ...original, status: snapshotStatus } },
      });
      return t.fetch("/stripe/webhook", {
        method: "POST",
        body,
        headers: {
          "stripe-signature": isValid
            ? await signature(body)
            : "t=0,v1=invalid",
        },
      });
    },
  };
}

it("control: rejects an invalid signature before provider/component writes", async () => {
  const f = fixture();
  expect(
    (await f.send("evt_invalid", "pending", undefined, false)).status,
  ).toBe(400);
  expect(f.calls).toEqual([]);
  expect(await f.row()).toBeNull();
});

it.each([true, false])(
  "reconciles current provider state through registered=%s delivery",
  async (registered) => {
    const f = fixture(registered);
    f.set("requires_action");
    expect((await f.send("evt_old_pending")).status).toBe(200);
    expect(await f.row()).toMatchObject({ status: "requires_action" });
    expect(f.calls).toEqual([
      { path: "/v1/refunds/re_delivery", method: "GET", account: undefined },
    ]);
  },
);

it("does not ACK a current-provider outage or apply the snapshot", async () => {
  const f = fixture();
  f.set("pending", 503);
  expect((await f.send("evt_outage")).status).toBe(500);
  expect(await f.row()).toBeNull();
  expect(
    await f.t.query(component.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_outage",
    }),
  ).toMatchObject({ status: "failed" });
});

it("reopens the same failed event against current provider state", async () => {
  const f = fixture();
  f.set("pending", 503);
  expect((await f.send("evt_retry")).status).toBe(500);
  f.set("requires_action");
  expect((await f.send("evt_retry")).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "requires_action" });
  expect(f.callbackStatuses).toEqual(["requires_action"]);
});

it("deduplicates a processed event without another GET or changed callback", async () => {
  const f = fixture();
  f.set("requires_action");
  expect((await f.send("evt_duplicate")).status).toBe(200);
  expect((await f.send("evt_duplicate")).status).toBe(200);
  expect(f.calls).toHaveLength(1);
  expect(f.callbackStatuses).toEqual(["requires_action"]);
});

it("does not ACK a fresh processing refund when optional hook retry is disabled", async () => {
  const f = fixture();
  await f.t.mutation(component.webhooks.mutations.insertWebhookEvent, {
    stripeEventId: "evt_processing",
    eventType: "refund.updated",
  });
  expect((await f.send("evt_processing")).status).toBe(503);
  expect(f.calls).toEqual([]);
});

it("reopens stale processing through current provider reconciliation", async () => {
  const f = fixture();
  await f.t.mutation(component.webhooks.mutations.insertWebhookEvent, {
    stripeEventId: "evt_stale",
    eventType: "refund.updated",
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    f.set("requires_action");
    expect((await f.send("evt_stale")).status).toBe(200);
    expect(await f.row()).toMatchObject({ status: "requires_action" });
  } finally {
    vi.useRealTimers();
  }
});

it("rolls back acceptance when a registered changed callback fails, then retries", async () => {
  const f = fixture();
  f.set("requires_action");
  f.failCallback(true);
  expect((await f.send("evt_callback")).status).toBe(500);
  expect(await f.row()).toBeNull();
  f.failCallback(false);
  expect((await f.send("evt_callback")).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "requires_action" });
});

it("uses signed connected account only as the HTTP API realm", async () => {
  const f = fixture();
  f.set("requires_action");
  expect(
    (await f.send("evt_connected", "pending", "acct_signed_realm")).status,
  ).toBe(200);
  expect(f.calls).toEqual([
    {
      path: "/v1/refunds/re_delivery",
      method: "GET",
      account: "acct_signed_realm",
    },
  ]);
  expect((await f.row())?.accountId).toBeUndefined();
});

it("allows a legitimate current bank-return transition after succeeded", async () => {
  const f = fixture();
  f.set("succeeded");
  expect((await f.send("evt_success", "pending")).status).toBe(200);
  f.set("requires_action");
  expect((await f.send("evt_return", "succeeded")).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "requires_action" });
  expect(f.callbackStatuses).toEqual(["succeeded", "requires_action"]);
});

it("does not substitute notification fields for malformed current identity", async () => {
  const f = fixture();
  f.setRefund({ id: "re_foreign", status: "requires_action" });
  expect((await f.send("evt_foreign")).status).toBe(500);
  expect(await f.row()).toBeNull();
  expect(f.callbackStatuses).toEqual([]);
});

it.each(["refund.created", "refund.updated", "refund.failed"])(
  "reconciles %s from the current source",
  async (type) => {
    const f = fixture();
    f.set("requires_action");
    expect(
      (await f.send(`evt_${type}`, "pending", undefined, true, type)).status,
    ).toBe(200);
    expect(await f.row()).toMatchObject({ status: "requires_action" });
  },
);

it("holds connected refund recovery before any unscoped platform transfer operation", async () => {
  const f = fixture();
  await f.seedLeg();
  f.enableRecovery();
  f.set("succeeded");
  expect(
    (await f.send("evt_connected_leg", "pending", "acct_signed_realm")).status,
  ).toBe(500);
  expect(f.calls).toEqual([
    {
      path: "/v1/refunds/re_delivery",
      method: "GET",
      account: "acct_signed_realm",
    },
  ]);
  expect(f.reversalRequests).toEqual([]);
});

it("runs existing platform split recovery from current success despite pending snapshot", async () => {
  const f = fixture();
  await f.seedLeg();
  f.enableRecovery();
  f.set("succeeded");
  expect((await f.send("evt_split", "pending")).status).toBe(200);
  expect(f.reversalRequests).toEqual([
    {
      body: "amount=250",
      key: "bs_rev_re_delivery_tr_delivery",
      account: undefined,
    },
  ]);
  expect(f.providerReversed()).toBe(250);
  expect((await f.send("evt_split", "pending")).status).toBe(200);
  expect(f.reversalRequests).toHaveLength(1);
});

it("retries an existing failed reversal after unchanged mirror without repeating changed callback", async () => {
  const f = fixture();
  await f.seedLeg();
  f.enableRecovery();
  f.set("succeeded");
  f.failReversal(true);
  expect((await f.send("evt_split_retry", "pending")).status).toBe(500);
  expect(await f.row()).toMatchObject({ status: "succeeded" });
  expect(f.callbackStatuses).toEqual(["succeeded"]);
  f.failReversal(false);
  expect((await f.send("evt_split_retry", "pending")).status).toBe(200);
  expect(f.reversalRequests).toHaveLength(2);
  expect(f.reversalRequests[0]).toEqual(f.reversalRequests[1]);
  expect(f.providerReversed()).toBe(250);
  expect(f.callbackStatuses).toEqual(["succeeded"]);
});

it("recovers a lost committed reversal response from existing transfer receipt without another POST", async () => {
  const f = fixture();
  await f.seedLeg();
  f.enableRecovery();
  f.set("succeeded");
  f.loseReversalResponse();
  expect((await f.send("evt_split_lost", "pending")).status).toBe(500);
  expect(f.providerReversed()).toBe(250);
  expect((await f.send("evt_split_lost", "pending")).status).toBe(200);
  expect(f.reversalRequests).toHaveLength(1);
  const legs = await f.t.query(
    component.connect.queries.listTransfersByCharge,
    { sourceChargeId: "ch_delivery" },
  );
  expect(legs[0]).toMatchObject({ reversedAmount: 250 });
});

it("fails a delayed older observation after a newer delivery accepts without stale callback", async () => {
  const f = fixture();
  const pause = f.pauseNextRead();
  const old = f.send("evt_old_racing");
  await pause.started;
  try {
    f.set("requires_action");
    expect((await f.send("evt_new_racing")).status).toBe(200);
  } finally {
    pause.release();
  }
  expect((await old).status).toBe(500);
  expect(await f.row()).toMatchObject({ status: "requires_action" });
  expect(f.callbackStatuses).toEqual(["requires_action"]);
  expect(
    await f.t.query(component.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_old_racing",
    }),
  ).toMatchObject({ status: "failed" });
});
