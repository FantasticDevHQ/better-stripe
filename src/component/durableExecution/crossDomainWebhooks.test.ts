// @vitest-environment edge-runtime
import { anyApi, componentsGeneric } from "convex/server";
import Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { handleWebhookRequest } from "../../client/webhooks/handler.js";
import type { Component } from "../../client/helpers.js";
import type { RegisterRoutesConfig } from "../../client/types.js";
import {
  fixture,
  fundingScope,
  scope,
  wire,
} from "../../testing/crossDomain/fixture.js";
import { ga, secret } from "../../testing/crossDomain/transport.js";
const nested = componentsGeneric().betterStripe;
it("retries a signed invoice hook and deduplicates delivery without restarting settlement or funding", async () => {
  const t = fixture();
  await t.mutation(anyApi.host.prepareRecovery, {
    name: "a",
    kind: "settlement",
    amount: 60,
  });
  await t.action(anyApi.host.funding, { requestKey: "parallel-funding" });
  const event = {
    id: "evt_cross_domain_invoice",
    object: "event",
    type: "invoice.paid",
    api_version: ga,
    livemode: false,
    data: {
      object: {
        id: "in_original",
        object: "invoice",
        status: "paid",
        currency: "usd",
        amount_due: 1000,
        amount_paid: 1000,
        metadata: {},
      },
    },
  };
  const starts: { operationId: string; version: number }[] = [];
  const config: RegisterRoutesConfig = {
    stripeSecretKey: secret,
    stripeApiVersion: ga,
    webhookSecret: "whsec_cross_domain_signature_only",
    retryOnHookError: () => true,
    events: {
      "invoice.paid": async (ctx, verified) => {
        const op = await ctx.runMutation(anyApi.host.startRecovery, {
          name: "a",
          kind: "settlement",
          requestKey: verified.id,
        });
        starts.push(op);
        if (starts.length === 1)
          throw new Error("Fixture host response interrupted after scheduling");
      },
    },
  };
  const deliver = async (tamper = false) => {
    const body = JSON.stringify(event);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret: config.webhookSecret!,
    });
    return t.action(async (ctx) => {
      const response = await handleWebhookRequest(
        ctx,
        new Request("https://example.test/stripe/webhook", {
          method: "POST",
          body: tamper ? body.replace("in_original", "in_tampered") : body,
          headers: { "stripe-signature": signature },
        }),
        nested as unknown as Component,
        config,
      );
      return { status: response.status, body: await response.json() };
    });
  };
  const ledger = () =>
    t.query(nested.webhooks.queries.getWebhookEvent, {
      stripeEventId: event.id,
    });
  expect((await deliver(true)).status).toBe(400);
  expect(await ledger()).toBeNull();
  expect(starts).toHaveLength(0);
  expect((await deliver()).status).toBe(500);
  expect(await ledger()).toMatchObject({ status: "failed" });
  expect((await deliver()).status).toBe(200);
  expect(await deliver()).toMatchObject({
    status: 200,
    body: { deduplicated: true },
  });
  expect(starts).toHaveLength(2);
  expect(starts[1].operationId).toBe(starts[0].operationId);
  expect(await ledger()).toMatchObject({ status: "processed" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.recoveryWorkflow.queries.get, {
      ...scope(),
      groupKey: "settlement:a",
      operationId: starts[0].operationId,
      version: starts[0].version,
    }),
  ).toMatchObject({ status: "completed" });
  expect(
    await t.query(nested.balanceFunding.queries.readScopePreparation, {
      ...fundingScope(),
      providerApiVersion: "2026-09-30.preview",
    }),
  ).toMatchObject({
    verified: true,
    preparation: { previousPaymentMethodId: "pm_card_a" },
  });
  expect(
    wire.calls.filter((r) => r.method === "POST" && r.path === "/v1/transfers"),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("reports").take(10))).toHaveLength(
    1,
  );
});
