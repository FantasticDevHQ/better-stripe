import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { parseUsageQuantity } from "@fantastic.dev/better-stripe/usage";
import { demoActor, demoRun } from "./authorization";
import {
  demoModel,
  demoRunFields,
  demoResourceFields,
  demoActivityFields,
} from "./schema";
import { demoWorkTimestamp, parseDemoConfiguration } from "./policy";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
const runDoc = v.object({
  _id: v.id("meteredDemoRuns"),
  _creationTime: v.number(),
  ...demoRunFields,
});
const resourceDoc = v.object({
  _id: v.id("meteredDemoResources"),
  _creationTime: v.number(),
  ...demoResourceFields,
});
const activityDoc = v.object({
  _id: v.id("meteredDemoActivities"),
  _creationTime: v.number(),
  ...demoActivityFields,
});
export const begin = internalMutation({
  args: {
    actorId: v.id("users"),
    model: demoModel,
    configurationJson: v.string(),
  },
  returns: v.id("meteredDemoRuns"),
  handler: async (ctx, args) => {
    const actor = await demoActor(ctx, args.actorId);
    const configurationJson = JSON.stringify(
      parseDemoConfiguration(args.configurationJson, args.model),
    );
    const latest = await ctx.db
      .query("meteredDemoRuns")
      .withIndex("by_actor_model", (q) =>
        q.eq("actorId", args.actorId).eq("model", args.model),
      )
      .order("desc")
      .first();
    if (latest && !latest.archived) {
      if (latest.configurationJson !== configurationJson)
        throw new Error(
          "Retain the original configuration until the existing sandbox run is safely archived.",
        );
      return latest._id;
    }
    const affiliates =
      actor.role === "seller" && actor.stripeAccountId
        ? await ctx.db
            .query("users")
            .withIndex("by_role", (q) => q.eq("role", "affiliate"))
            .take(10)
        : [];
    const affiliate = affiliates.find(
      (user) =>
        !user.testFixture &&
        user.stripeAccountId &&
        user.stripeAccountId !== actor.stripeAccountId,
    );
    const settlementPolicyJson = JSON.stringify({
      feeBasisPoints: 1000,
      commissionTerm: "forever",
      ...(actor.role === "seller" && actor.stripeAccountId
        ? { creatorAccountId: actor.stripeAccountId }
        : {}),
      ...(affiliate?.stripeAccountId
        ? {
            affiliate: {
              destinationAccountId: affiliate.stripeAccountId,
              basisPoints: 2000,
            },
          }
        : {}),
    });
    return ctx.db.insert("meteredDemoRuns", {
      settlementPolicyJson,
      actorId: args.actorId,
      model: args.model,
      configurationJson,
      createdAt: Date.now(),
      archived: false,
    });
  },
});
export const read = internalQuery({
  args: ref,
  returns: runDoc,
  handler: (ctx, args) => demoRun(ctx, args.actorId, args.runId),
});
export const current = internalQuery({
  args: { actorId: v.id("users"), model: demoModel },
  returns: v.union(runDoc, v.null()),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    return ctx.db
      .query("meteredDemoRuns")
      .withIndex("by_actor_model", (q) =>
        q.eq("actorId", args.actorId).eq("model", args.model),
      )
      .order("desc")
      .first();
  },
});
export const prepareResource = internalMutation({
  args: { ...ref, kind: v.string() },
  returns: resourceDoc,
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (run.archived) throw new Error("Sandbox run is archived.");
    const saved = await ctx.db
      .query("meteredDemoResources")
      .withIndex("by_run_kind", (q) =>
        q.eq("runId", args.runId).eq("kind", args.kind),
      )
      .unique();
    if (saved) return saved;
    const id = await ctx.db.insert("meteredDemoResources", {
      runId: args.runId,
      kind: args.kind,
      createdAt: Date.now(),
    });
    return (await ctx.db.get("meteredDemoResources", id))!;
  },
});
export const pinResource = internalMutation({
  args: { ...ref, kind: v.string(), stripeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await demoRun(ctx, args.actorId, args.runId);
    const saved = await ctx.db
      .query("meteredDemoResources")
      .withIndex("by_run_kind", (q) =>
        q.eq("runId", args.runId).eq("kind", args.kind),
      )
      .unique();
    if (!saved || (saved.stripeId && saved.stripeId !== args.stripeId))
      throw new Error("Native fixture identity cannot change.");
    await ctx.db.patch("meteredDemoResources", saved._id, {
      stripeId: args.stripeId,
    });
    return null;
  },
});
export const saveProvider = internalMutation({
  args: { ...ref, providerJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (run.providerJson && run.providerJson !== args.providerJson)
      throw new Error("Original native binding cannot change.");
    await ctx.db.patch("meteredDemoRuns", run._id, {
      providerJson: args.providerJson,
    });
    return null;
  },
});
export const activity = internalMutation({
  args: { ...ref, requestId: v.string(), quantity: v.string() },
  returns: activityDoc,
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (run.archived) throw new Error("Sandbox run is archived.");
    if (!/^[\w.-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid work identity.");
    const config = parseDemoConfiguration(run.configurationJson, run.model);
    const quantity = parseUsageQuantity(
      args.quantity,
      config.plan.unit.precision,
    );
    if (quantity.scaledQuantity === "0")
      throw new Error("Synthetic work requires positive units.");
    const saved = await ctx.db
      .query("meteredDemoActivities")
      .withIndex("by_run_request", (q) =>
        q.eq("runId", args.runId).eq("requestId", args.requestId),
      )
      .unique();
    if (saved) {
      if (saved.quantity !== quantity.quantity)
        throw new Error("Replay must retain original work quantity and time.");
      return saved;
    }
    if (run.billingStartedAt !== undefined)
      throw new Error("The original billing period is closing.");
    const id = await ctx.db.insert("meteredDemoActivities", {
      runId: args.runId,
      requestId: args.requestId,
      quantity: quantity.quantity,
      occurredAt: demoWorkTimestamp(
        run.providerJson,
        Math.floor(Date.now() / 1000),
      ),
    });
    await ctx.db.patch("meteredDemoRuns", run._id, { lastActivityId: id });
    return (await ctx.db.get("meteredDemoActivities", id))!;
  },
});
export const lastActivity = internalQuery({
  args: ref,
  returns: v.union(activityDoc, v.null()),
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (!run.lastActivityId) return null;
    const row = await ctx.db.get("meteredDemoActivities", run.lastActivityId);
    return row?.runId === run._id ? row : null;
  },
});
export const authorize = internalQuery({
  args: { actorId: v.id("users") },
  returns: v.object({ role: v.string() }),
  handler: async (ctx, args) => ({
    role: (await demoActor(ctx, args.actorId)).role,
  }),
});
export const acceptedActivity = internalQuery({
  args: ref,
  returns: v.union(activityDoc, v.null()),
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    const id = run.lastAcceptedActivityId ?? run.lastActivityId;
    if (!id) return null;
    const row = await ctx.db.get("meteredDemoActivities", id);
    return row?.runId === run._id && row.receiptId ? row : null;
  },
});
export const freezeBilling = internalMutation({
  args: ref,
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (run.archived) throw new Error("Sandbox run is archived.");
    if (run.billingStartedAt === undefined)
      await ctx.db.patch("meteredDemoRuns", run._id, {
        billingStartedAt: Date.now(),
      });
    return null;
  },
});
export const saveBilling = internalMutation({
  args: { ...ref, billingJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await demoRun(ctx, args.actorId, args.runId);
    await ctx.db.patch("meteredDemoRuns", args.runId, {
      billingJson: args.billingJson,
    });
    return null;
  },
});
export const prepareCorrection = internalMutation({
  args: ref,
  returns: activityDoc,
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    let work = run.lastAcceptedActivityId
      ? await ctx.db.get("meteredDemoActivities", run.lastAcceptedActivityId)
      : null;
    if (!work) {
      const page = await ctx.db
        .query("meteredDemoActivities")
        .withIndex("by_run_request", (q) => q.eq("runId", run._id))
        .take(101);
      if (page.length > 100)
        throw new Error(
          "Select original accepted work from complete scoped history.",
        );
      work =
        page
          .filter((row) => row.receiptId)
          .sort(
            (a, b) =>
              (b.completedAt ?? b._creationTime) -
              (a.completedAt ?? a._creationTime),
          )[0] ?? null;
    }
    if (!work || work.runId !== run._id || !work.receiptId)
      throw new Error(
        "No accepted original event is available for correction.",
      );
    const requested = run.correctionActivityIds ?? [];
    if (!requested.includes(work._id)) {
      if (run.archived || run.billingStartedAt !== undefined)
        throw new Error(
          "The original billing period is closing. Reconcile retained corrections before new requests.",
        );
      if (requested.length >= 100)
        throw new Error("The sandbox correction-intent budget is exhausted.");
      await ctx.db.patch("meteredDemoRuns", run._id, {
        correctionActivityIds: [...requested, work._id],
        lastAcceptedActivityId: work._id,
      });
    }
    return work;
  },
});
export const getActivity = internalQuery({
  args: { ...ref, activityId: v.id("meteredDemoActivities") },
  returns: activityDoc,
  handler: async (ctx, args) => {
    await demoRun(ctx, args.actorId, args.runId);
    const row = await ctx.db.get("meteredDemoActivities", args.activityId);
    if (!row || row.runId !== args.runId)
      throw new Error("Original work is unavailable for this run.");
    return row;
  },
});

export const saveCleanup = internalMutation({
  args: { ...ref, cleanupJson: v.string(), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await demoRun(ctx, args.actorId, args.runId);
    await ctx.db.patch("meteredDemoRuns", args.runId, {
      cleanupJson: args.cleanupJson,
      archived: args.archived,
    });
    return null;
  },
});
