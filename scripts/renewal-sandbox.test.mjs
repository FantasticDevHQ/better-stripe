import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  queryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { expect, it } from "vitest";
import {
  BetterStripe,
  prepareRenewalAttachmentOperation,
  prepareRenewalConfigurationOperation,
} from "../src/client/node.js";
import { components } from "../example/convex/_generated/api.js";
import { modules, schema } from "../src/test.js";
import {
  modules as exampleModules,
  schema as exampleSchema,
} from "../example/test.js";

// Opt-in only. A skipped probe is not sandbox evidence. Never run with a live key.
const key = process.env.BTS_RENEWAL_SANDBOX_KEY;
it.skipIf(!key)(
  "qualifies public attachment and configuration against a dedicated real Stripe sandbox",
  async () => {
    if (!/^[rs]k_test_/.test(key))
      throw Error("A dedicated Stripe test key is required");
    const stripe = new Stripe(key, {
      apiVersion: "2026-09-30.endive",
      maxNetworkRetries: 0,
    });
    const runId = `renewal-sandbox-${randomUUID()}`;
    const resources = {};
    const cleanup = [];
    let stage = "setup",
      acknowledged = false,
      configureUncertain = false,
      measured = false;
    const calls = [];
    const originalFetch = globalThis.fetch;
    const report = {
      runId,
      runtime: "Node with convex-test component journal",
      servingBackend: false,
      provider: "real Stripe sandbox",
      resources,
      cleanup,
    };
    try {
      const buyer = await stripe.v2.core.accounts.create(
        {
          display_name: "Renewal attachment sandbox fixture",
          contact_email: "renewal-sandbox@example.com",
          configuration: { customer: {} },
          metadata: { qualification: runId },
        },
        { idempotencyKey: `${runId}:buyer` },
      );
      resources.buyerId = buyer.id;
      const products = [];
      const prices = [];
      stage = "catalog fixture";
      for (const [name, amount] of [
        ["Original", 1000],
        ["Replacement", 1200],
      ]) {
        const product = await stripe.products.create(
          { name: `${name} ${runId}`, metadata: { qualification: runId } },
          { idempotencyKey: `${runId}:${name}:product` },
        );
        products.push(product.id);
        resources.productIds = [...products];
        const price = await stripe.prices.create(
          {
            product: product.id,
            currency: "usd",
            unit_amount: amount,
            recurring: { interval: "month" },
          },
          { idempotencyKey: `${runId}:${name}:price` },
        );
        prices.push(price.id);
        resources.priceIds = [...prices];
      }
      stage = "subscription fixture";
      const subscription = await stripe.subscriptions.create(
        {
          customer_account: buyer.id,
          items: [{ price: prices[0] }],
          billing_mode: { type: "classic" },
          collection_method: "send_invoice",
          days_until_due: 30,
          metadata: { qualification: runId },
        },
        { idempotencyKey: `${runId}:subscription` },
      );
      resources.subscriptionId = subscription.id;
      stage = "invoice fixture";
      if (typeof subscription.latest_invoice !== "string")
        throw Error("Fixture invoice missing");
      await stripe.invoices.pay(
        subscription.latest_invoice,
        { paid_out_of_band: true },
        { idempotencyKey: `${runId}:fixture-paid-out-of-band` },
      );
      const item = subscription.items.data[0];
      const expected = {
        customerAccountId: buyer.id,
        subscriptionId: subscription.id,
        itemId: item.id,
        currentPriceId: prices[0],
        currentProductId: products[0],
        targetPriceId: prices[1],
        targetProductId: products[1],
        periodStart: item.current_period_start,
        periodEnd: item.current_period_end,
        livemode: false,
      };
      const client = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: key,
      });
      const refs = components.betterStripe.renewalOperations;
      const host = {
        authorize: queryGeneric({
          args: {
            capability: v.string(),
            operationId: v.string(),
            attachmentOperationId: v.optional(v.string()),
            authorizationScope: v.string(),
            authorizationId: v.string(),
            authorizationRevision: v.number(),
            logicalOperationId: v.string(),
            requestBinding: v.string(),
            expected: v.any(),
          },
          returns: v.boolean(),
          handler: async (ctx, args) =>
            (await ctx.auth.getUserIdentity())?.subject === runId &&
            args.authorizationId === runId &&
            args.expected.subscriptionId === subscription.id &&
            args.expected.customerAccountId === buyer.id,
        }),
        run: actionGeneric({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            stage = "context acquisition";
            const context = await client.readRenewalPriceReplacementContext(
              ctx,
              { expected },
            );
            stage = "public preparation";
            const prepared = await prepareRenewalAttachmentOperation({
              preparation: {
                subscription: context.subscription,
                targetPrice: context.targetPrice,
                billingCustomer: context.billingCustomer,
                expected,
                key: runId,
              },
              authorization: {
                scope: "sandbox-qualification",
                id: runId,
                revision: 1,
              },
              logicalOperationId: runId,
              attachKey: `${runId}:attach`,
              firstDispatchedAt: Math.floor(Date.now() / 1000),
            });
            const operation = await ctx.runMutation(
              refs.mutations.createAuthorizedOperation,
              prepared.createArgs,
            );
            expect(operation.status).toBe("created");
            const options = {
              operationId: operation.operationId,
              requestBinding: prepared.requestBinding,
              authorizationQuery: makeFunctionReference(
                "sandboxAttachment:authorize",
              ),
            };
            stage = "public attachment";
            globalThis.fetch = (input, init) => {
              if (measured)
                calls.push({
                  method: init?.method ?? "GET",
                  path: new URL(String(input)).pathname,
                });
              return originalFetch(input, init);
            };
            measured = true;
            const result = await client.attachRenewalSchedule(ctx, options);
            measured = false;
            report.result = result.status;
            report.providerWrites = calls.filter(
              (row) => row.method === "POST",
            ).length;
            expect(result.status).toBe("attached_incomplete");
            acknowledged = true;
            resources.scheduleId = result.receipt.scheduleId;
            expect(report.providerWrites).toBe(1);
            stage = "journal readback";
            const receipt = await ctx.runQuery(
              refs.queries.readProviderAcknowledgement,
              { operationId: operation.operationId },
            );
            expect(receipt).not.toBeNull();
            report.acknowledgementRetained = true;
            measured = true;
            expect(
              (await client.attachRenewalSchedule(ctx, options)).status,
            ).toBe("conflict");
            measured = false;
            expect(calls.filter((row) => row.method === "POST")).toHaveLength(
              1,
            );
            report.duplicateProviderWrites = 0;
            stage = "public configure preparation";
            const parent = await ctx.runQuery(
              refs.queries.loadAuthorizedOperation,
              { operationId: operation.operationId },
            );
            const configuration = await prepareRenewalConfigurationOperation({
              attachment: {
                operationId: operation.operationId,
                recordJSON: parent.recordJSON,
                attemptId: parent.activeAttempt.attemptId,
                sourcePayloadId: parent.activeAttempt.payloadId,
                receiptJSON: receipt.receiptJSON,
              },
              authorization: {
                scope: "sandbox-qualification",
                id: runId,
                revision: 1,
              },
              logicalOperationId: `${runId}:configure`,
              configureKey: `${runId}:configure`,
              firstDispatchedAt: Math.floor(Date.now() / 1000),
            });
            const child = await ctx.runMutation(
              refs.mutations.createAuthorizedOperation,
              configuration.createArgs,
            );
            expect(child.status).toBe("created");
            report.configureIdentity = {
              operationId: child.operationId,
              logicalOperationId: `${runId}:configure`,
              key: `${runId}:configure`,
              firstDispatchedAt: JSON.parse(configuration.createArgs.recordJSON)
                .dispatch.firstDispatchedAt,
            };
            const configureOptions = {
              operationId: child.operationId,
              requestBinding: configuration.requestBinding,
              authorizationQuery: options.authorizationQuery,
            };
            stage = "public configuration";
            measured = true;
            configureUncertain = true;
            const configured = await client.configureRenewalSchedule(
              ctx,
              configureOptions,
            );
            measured = false;
            report.configureResult = configured.status;
            expect(configured.status).toBe("configure_acknowledged");
            configureUncertain = false;
            expect(calls.filter((row) => row.method === "POST")).toHaveLength(
              2,
            );
            const configureAck = await ctx.runQuery(
              refs.queries.readProviderAcknowledgement,
              { operationId: child.operationId },
            );
            expect(configureAck).not.toBeNull();
            report.configureAcknowledgementRetained = true;
            measured = true;
            expect(
              (await client.configureRenewalSchedule(ctx, configureOptions))
                .status,
            ).toBe("conflict");
            measured = false;
            expect(calls.filter((row) => row.method === "POST")).toHaveLength(
              2,
            );
            report.configureProviderWrites = 1;
            stage = "provider configure readback";
            const schedule = await stripe.subscriptionSchedules.retrieve(
              resources.scheduleId,
            );
            expect(schedule.phases).toHaveLength(2);
            expect(schedule.phases[0].items[0].price).toBe(prices[0]);
            expect(schedule.phases[0].end_date).toBe(expected.periodEnd);
            expect(schedule.phases[1].start_date).toBe(expected.periodEnd);
            expect(schedule.phases[1].items[0].price).toBe(prices[1]);
            expect(schedule.phases[0].items[0].quantity).toBe(item.quantity);
            expect(schedule.phases[1].items[0].quantity).toBe(item.quantity);
            report.providerPhaseBoundaryVerified = true;

            return null;
          },
        }),
      };
      const t = convexTest(exampleSchema, {
        ...exampleModules,
        "./convex/sandboxAttachment.ts": async () => host,
      });
      t.registerComponent("betterStripe", schema, modules);
      await t
        .withIdentity({
          subject: runId,
          issuer: "https://sandbox.invalid",
          tokenIdentifier: `sandbox|${runId}`,
        })
        .action(makeFunctionReference("sandboxAttachment:run"), {});
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.failedStage = stage;
      if (
        error instanceof Error &&
        /^RENEWAL_CONFIGURATION_[a-z_]+$/.test(error.message)
      )
        report.refusalReason = error.message;
      if (error instanceof Stripe.errors.StripeError)
        report.providerError = {
          type: error.type,
          code: error.code,
          param: error.param,
          status: error.statusCode,
        };
      // Provider errors can carry request details. Keep keys and raw bodies out of evidence.
      throw Error(
        `Sandbox attachment qualification failed at ${stage} (${error instanceof Error ? error.name : "error"})`,
      );
    } finally {
      measured = false;
      globalThis.fetch = originalFetch;
      const clean = async (label, work) => {
        try {
          await work();
          cleanup.push({ step: label, status: "done" });
        } catch {
          cleanup.push({ step: label, status: "failed" });
        }
      };
      // Cleanup is separate from the operation under test. Unknown writes are held for investigation.
      if (acknowledged && !configureUncertain && resources.scheduleId)
        await clean("release acknowledged fixture schedule", () =>
          stripe.subscriptionSchedules.release(resources.scheduleId),
        );
      if (resources.subscriptionId) {
        const current = await stripe.subscriptions
          .retrieve(resources.subscriptionId)
          .catch(() => null);
        if (current?.schedule)
          cleanup.push({
            step: "cancel fixture subscription",
            status: "held: schedule outcome needs investigation",
          });
        else
          await clean("cancel fixture subscription", () =>
            stripe.subscriptions.cancel(resources.subscriptionId),
          );
      }
      for (const id of resources.priceIds ?? [])
        await clean(`archive ${id}`, () =>
          stripe.prices.update(id, { active: false }),
        );
      for (const id of resources.productIds ?? [])
        await clean(`archive ${id}`, () =>
          stripe.products.update(id, { active: false }),
        );
      if (resources.buyerId)
        await clean("close fixture buyer", () =>
          stripe.v2.core.accounts.close(resources.buyerId, {
            applied_configurations: ["customer"],
          }),
        );
      console.log(JSON.stringify(report));
      if (cleanup.some((row) => row.status !== "done"))
        throw Error(
          "Sandbox cleanup is incomplete; inspect the sanitized resource report",
        );
    }
  },
  120_000,
);
