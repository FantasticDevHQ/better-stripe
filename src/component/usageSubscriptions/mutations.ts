import { abandonEnrollment } from "./abandonment.js";
import { retireEnrollment } from "./retirement.js";
import { appendSnapshot, saveView } from "./history.js";
import { controlDoc } from "./schema.js";
import { managedInvoiceSchema } from "../../client/usage/subscriptionInvoiceSchema.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { intentDoc, method } from "./schema.js";
import { intentKey, jsonTerms, observationStart } from "./helpers.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { subscriptionScope } from "../../client/usage/subscriptionTerms.js";
export const prepare = mutation({
  args: { termsJson: v.string(), method },
  returns: intentDoc,
  handler: async (ctx, args) => {
    const parsed = jsonTerms(args.termsJson),
      { terms } = parsed;
    if (
      (terms.collection.method === "checkout") !==
      (args.method === "checkout")
    )
      throw new Error("Subscription creation method conflict");
    const key = await intentKey(subscriptionScope(terms), terms.requestId);
    const prior = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (prior) {
      if (prior.termsJson !== parsed.termsJson || prior.method !== args.method)
        throw new Error("Subscription intent replay conflict");
      return prior;
    }
    for (const { scope, binding } of terms.meters) {
      const lockKey = JSON.stringify([
        scope.stripeAccountId,
        scope.livemode,
        binding.stripeCustomerId,
        scope.meterId,
      ]);
      const lock = await ctx.db
        .query("usageSubscriptionLocks")
        .withIndex("by_key", (q) => q.eq("key", lockKey))
        .unique();
      if (lock)
        throw new Error("Native customer/meter enrollment already reserved");
      await ctx.db.insert("usageSubscriptionLocks", {
        key: lockKey,
        intentKey: key,
      });
    }
    const id = await ctx.db.insert("usageSubscriptionIntents", {
      key,
      scopeKey: parsed.scopeKey,
      termsJson: parsed.termsJson,
      method: args.method,
      firstAttemptAt: Math.floor(Date.now() / 1000),
    });
    return (await ctx.db.get("usageSubscriptionIntents", id))!;
  },
});

export const save = mutation({
  args: { key: v.string(), nativeJson: v.string(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    observationStart(args.startedAt);
    if (new TextEncoder().encode(args.nativeJson).length > 65536)
      throw new Error("Subscription observation exceeds size limit");
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!intent) throw new Error("Subscription intent not found");
    await saveView(ctx, intent, args.nativeJson, args.startedAt);
    return null;
  },
});

export const linkCheckout = mutation({
  args: { key: v.string(), checkoutId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!/^cs_[a-zA-Z0-9_]{1,200}$/.test(args.checkoutId))
      throw new Error("Invalid Checkout identity");
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      !intent ||
      intent.method !== "checkout" ||
      (intent.checkoutId && intent.checkoutId !== args.checkoutId)
    )
      throw new Error("Checkout intent identity conflict");
    await ctx.db.patch("usageSubscriptionIntents", intent._id, {
      checkoutId: args.checkoutId,
    });
    return null;
  },
});

export const saveInvoice = mutation({
  args: {
    key: v.string(),
    invoiceId: v.string(),
    observationsJson: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    observationStart(args.startedAt);
    if (
      !/^in_[a-zA-Z0-9]{1,100}$/.test(args.invoiceId) ||
      new TextEncoder().encode(args.observationsJson).length > 131072
    )
      throw new Error("Invalid managed invoice observation");
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!intent?.providerId)
      throw new Error("Managed subscription unavailable");
    const { terms } = jsonTerms(intent.termsJson),
      observations = managedInvoiceSchema.parse(
        JSON.parse(args.observationsJson),
      );
    const seen = new Set<string>();
    for (const entry of observations) {
      const meter = terms.meters.find((m) => m.scope.meterId === entry.meterId);
      if (!meter || seen.has(entry.meterId))
        throw new Error("Managed invoice source mismatch");
      seen.add(entry.meterId);
      if (entry.observation.status !== "available") continue;
      const { value, observedAt } = entry.observation;
      if (
        observedAt > Math.floor(Date.now() / 1000) + 300 ||
        value.invoiceId !== args.invoiceId ||
        value.currency !== meter.binding.plan.rate.currency ||
        value.lines.some(
          (line) =>
            line.stripePriceId !== meter.binding.stripePriceId ||
            line.subscriptionItemId !== entry.subscriptionItemId ||
            line.currency !== value.currency ||
            line.nativePeriod.end < line.nativePeriod.start,
        ) ||
        (value.finalized && value.status === "draft")
      )
        throw new Error("Managed invoice provenance mismatch");
    }
    if (seen.size !== terms.meters.length)
      throw new Error("Incomplete managed invoice sources");
    await appendSnapshot(
      ctx,
      intent,
      "invoice",
      args.invoiceId,
      observations,
      args.startedAt,
    );
    return null;
  },
});

export const prepareCancellation = mutation({
  args: {
    key: v.string(),
    operationId: v.string(),
    cancelAtPeriodEnd: v.boolean(),
  },
  returns: controlDoc,
  handler: async (ctx, args) => {
    if (!args.operationId || args.operationId.length > 100)
      throw new Error("Invalid cancellation operation identity");
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!intent?.providerId)
      throw new Error("Managed subscription unavailable");
    const key = await canonicalFingerprint([intent.key, args.operationId]);
    const prior = await ctx.db
      .query("usageSubscriptionControls")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (prior) {
      if (prior.cancelAtPeriodEnd !== args.cancelAtPeriodEnd)
        throw new Error("Cancellation operation replay conflict");
      return prior;
    }
    if (intent.controlKey)
      throw new Error("A cancellation operation is pending reconciliation");
    const id = await ctx.db.insert("usageSubscriptionControls", {
      key,
      intentKey: intent.key,
      operationId: args.operationId,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      firstAttemptAt: Math.floor(Date.now() / 1000),
    });
    await ctx.db.patch("usageSubscriptionIntents", intent._id, {
      controlKey: key,
    });
    return (await ctx.db.get("usageSubscriptionControls", id))!;
  },
});
export const completeCancellation = mutation({
  args: { key: v.string(), nativeJson: v.string(), startedAt: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    observationStart(args.startedAt);
    const command = await ctx.db
      .query("usageSubscriptionControls")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!command) throw new Error("Cancellation command unavailable");
    if (command.resultJson) return command.resultJson;
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", command.intentKey))
      .unique();
    if (!intent || intent.controlKey !== command.key)
      throw new Error("Cancellation command ownership conflict");
    const view = await saveView(ctx, intent, args.nativeJson, args.startedAt);
    if (
      view.cancelAtPeriodEnd !== command.cancelAtPeriodEnd &&
      !["canceled", "incomplete_expired"].includes(view.status)
    )
      throw new Error("Cancellation outcome mismatch");
    const resultJson = JSON.stringify(view);
    await ctx.db.patch("usageSubscriptionControls", command._id, {
      resultJson,
    });
    await ctx.db.patch("usageSubscriptionIntents", intent._id, {
      controlKey: undefined,
    });
    return resultJson;
  },
});

export const retire = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!intent) throw new Error("Managed subscription unavailable");
    await retireEnrollment(ctx, intent, args.proofJson);
    return null;
  },
});

export const abandon = mutation({
  args: { key: v.string(), proofJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!intent) throw new Error("Managed signup unavailable");
    await abandonEnrollment(ctx, intent, args.proofJson);
    return null;
  },
});
