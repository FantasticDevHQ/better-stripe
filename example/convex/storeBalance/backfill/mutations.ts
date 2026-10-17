import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { components } from "../../_generated/api";
import { runDoc } from "./validators";

/** Installing this checkpoint fences all old starts before the first scan. */
export const start = internalMutation({
  args: { rescan: v.optional(v.literal(true)) },
  returns: v.id("storeBalanceMigrationRuns"),
  handler: async (ctx, args) => {
    const prior = await ctx.db
      .query("storeBalanceMigrationRuns")
      .withIndex("by_key", (q) => q.eq("key", "component-cutover"))
      .unique();
    if (prior) {
      if (args.rescan && prior.state !== "running")
        await ctx.db.patch("storeBalanceMigrationRuns", prior._id, {
          state: "running",
          cursor: null,
          scanned: 0,
          active: 0,
          held: 0,
          page: undefined,
        });
      return prior._id;
    }
    return ctx.db.insert("storeBalanceMigrationRuns", {
      key: "component-cutover",
      state: "running",
      cursor: null,
      scanned: 0,
      active: 0,
      held: 0,
    });
  },
});
/** A persisted bounded page is replayed after action interruption. */
export const reserve = internalMutation({
  args: { runId: v.id("storeBalanceMigrationRuns") },
  returns: runDoc,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("storeBalanceMigrationRuns", args.runId);
    if (!run) throw new Error("Migration run is missing.");
    if (run.state !== "running" || run.page) return run;
    const page = await ctx.db
      .query("storeBalanceFunding")
      .paginate({ cursor: run.cursor, numItems: 10 });
    const reserved = {
      ids: page.page.map((row) => row._id),
      next: page.continueCursor,
      done: page.isDone,
    };
    await ctx.db.patch("storeBalanceMigrationRuns", run._id, {
      page: reserved,
    });
    return { ...run, page: reserved };
  },
});
export const checkpoint = internalMutation({
  args: {
    runId: v.id("storeBalanceMigrationRuns"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: runDoc,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("storeBalanceMigrationRuns", args.runId);
    if (!run) throw new Error("Migration run is missing.");
    if (run.cursor !== args.cursor || !run.page) return run; // Already acknowledged.
    let active = 0;
    for (const id of run.page.ids) {
      const row = await ctx.db.get("storeBalanceFunding", id);
      if (!row) throw new Error("Legacy row disappeared during migration.");
      const link = row.componentMigration;
      if (link?.state !== "active") continue;
      const seller = await ctx.db.get("users", row.sellerId);
      if (
        seller?.role !== "seller" ||
        seller.stripeAccountId !== link.accountId ||
        seller.storePlan?.stripeSubscriptionId !== row.subscriptionId
      )
        continue;
      const saved = await ctx.runQuery(
        components.betterStripe.balanceFunding.queries.readPreparation,
        {
          accountId: link.accountId,
          scopeKey: link.scopeKey,
          preparationId: link.preparationId,
          stripeSubscriptionId: row.subscriptionId,
        },
      );
      if (saved?.verified && !saved.activeOperationId && !saved.startsPaused)
        active++;
    }
    const held = run.held + run.page.ids.length - active;
    const patch = {
      cursor: run.page.next,
      scanned: run.scanned + run.page.ids.length,
      active: run.active + active,
      held,
      state: run.page.done
        ? held > 0
          ? ("held" as const)
          : ("verified" as const)
        : ("running" as const),
      page: undefined,
    };
    await ctx.db.patch("storeBalanceMigrationRuns", run._id, patch);
    return { ...run, ...patch };
  },
});
