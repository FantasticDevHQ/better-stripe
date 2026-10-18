import { v } from "convex/values";
import { action, env, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getStripeClient } from "../stripe/client";
import { stripe } from "../stripe/helpers";
import { ensureDemoAllowance } from "./allowance";
import { demoModel } from "./schema";
import {
  demoConfiguration,
  nativeDemoConfiguration,
  parseDemoConfiguration,
} from "./policy";
import { ensureDemoResource, type DemoRef } from "./resources";
import type { DemoProviderState } from "./types";
/** Native sandbox setup. Customer-configured accounts remain separate from merchant/recipient configurations. */
async function provision(ctx: ActionCtx, ref: DemoRef): Promise<void> {
  const run = await ctx.runQuery(internal.meteredUsage.state.read, ref);
  if (run.archived) throw new Error("Sandbox run is archived.");
  if (run.providerJson) return;
  const config = nativeDemoConfiguration(
    parseDemoConfiguration(run.configurationJson, run.model),
    run._id,
  );
  const raw = getStripeClient();
  const balance = await raw.balance.retrieve();
  if (balance.livemode)
    throw new Error("A native Stripe test realm is required.");
  const realm = await raw.accounts.retrieve(null);
  const clock = await ensureDemoResource(
    ctx,
    ref,
    "clock",
    (id) => raw.testHelpers.testClocks.retrieve(id),
    (idempotencyKey) =>
      raw.testHelpers.testClocks.create(
        {
          frozen_time: Math.floor(Date.now() / 60000) * 60 - 60,
          name: `BetterStripe usage ${run._id}`,
        },
        { idempotencyKey },
      ),
  );
  const payer = await ensureDemoResource(
    ctx,
    ref,
    "customer",
    (id) => raw.v2.core.accounts.retrieve(id),
    (idempotencyKey) =>
      raw.v2.core.accounts.create(
        {
          display_name: `BetterStripe usage ${run.model}`,
          contact_email: `usage-${run._id}@example.invalid`,
          configuration: { customer: { test_clock: clock.id } },
          identity: { country: "us" },
          metadata: { bsUsageDemo: run._id },
        },
        { idempotencyKey },
      ),
  );
  if (payer.livemode !== false)
    throw new Error("Expected a native test payer.");
  const customer = await raw.customers.retrieve(payer.id);
  if (
    "deleted" in customer ||
    customer.livemode ||
    customer.customer_account !== payer.id ||
    !customer.id.startsWith("cus_")
  )
    throw new Error("Original native payer mapping is unavailable.");
  const product = await ensureDemoResource(
    ctx,
    ref,
    "product",
    (id) => raw.products.retrieve(id),
    (idempotencyKey) =>
      raw.products.create(
        {
          name: `${config.displayName} · ${run.model}`,
          metadata: { bsUsageDemo: run._id },
        },
        { idempotencyKey },
      ),
  );
  if (!product.active || product.livemode)
    throw new Error("Original sandbox product is unavailable.");
  const catalogScope = { stripeAccountId: realm.id, livemode: false };
  const meter = await stripe.ensureUsageMeter(ctx, {
    scope: catalogScope,
    plan: config.plan,
    eventName: config.eventName,
    displayName: config.displayName,
  });
  const price = await stripe.ensureUsagePrice(ctx, {
    scope: catalogScope,
    plan: config.plan,
    meterId: meter.id,
    stripeProductId: product.id,
    lookupKey: `bs_demo_${run._id}`,
  });
  const binding = {
    stripeCustomerId: customer.id,
    stripePriceId: price.stripePriceId,
    eventName: config.eventName,
    plan: config.plan,
  };
  const scope = {
    ...catalogScope,
    customerAccount: payer.id,
    meterId: meter.id,
  };
  const requestId = `example_${run._id}`;
  const subscription = await stripe.usage.ensureSubscription(
    ctx,
    {
      requestId,
      meters: [{ scope, binding }],
      collection: { method: "send_invoice", daysUntilDue: 30 },
    },
    { stripeSecretKey: env.STRIPE_SECRET_KEY },
  );
  if (subscription.status !== "active" || subscription.bindings.length !== 1)
    throw new Error("Sandbox subscription is not active.");
  const original = subscription.bindings[0];
  if (config.plan.model !== "prepaid")
    await ensureDemoAllowance(ctx, stripe.usage, original);
  const provider: DemoProviderState = {
    clockId: clock.id,
    productId: product.id,
    requestId,
    price,
    meter: original,
  };
  await ctx.runMutation(internal.meteredUsage.state.saveProvider, {
    ...ref,
    providerJson: JSON.stringify(provider),
  });
}
export const setup = action({
  args: {
    actorId: v.id("users"),
    model: demoModel,
    configurationJson: v.optional(v.string()),
  },
  returns: v.id("meteredDemoRuns"),
  handler: async (ctx, args): Promise<Id<"meteredDemoRuns">> => {
    const actor = await ctx.runQuery(internal.meteredUsage.state.authorize, {
      actorId: args.actorId,
    });
    if (args.configurationJson && !["admin", "seller"].includes(actor.role))
      throw new Error(
        "Custom configuration requires an admin or seller demo persona.",
      );
    const config = args.configurationJson
      ? parseDemoConfiguration(args.configurationJson, args.model)
      : demoConfiguration(args.model);
    const runId = await ctx.runMutation(internal.meteredUsage.state.begin, {
      actorId: args.actorId,
      model: args.model,
      configurationJson: JSON.stringify(config),
    });
    try {
      await provision(ctx, { actorId: args.actorId, runId });
    } catch {
      throw new Error(
        "Sandbox setup is incomplete. Retry the same configuration; reconcile the original operations if it remains unavailable.",
      );
    }
    return runId;
  },
});
