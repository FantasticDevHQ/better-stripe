import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { doc, kind } from "./schema.js";
function bounded(value: string, max: number) {
  if (!value || new TextEncoder().encode(value).length > max)
    throw new Error("Invalid usage catalog size");
}
export const prepare = mutation({
  args: { scopeKey: v.string(), kind, key: v.string(), termsJson: v.string() },
  returns: doc,
  handler: async (ctx, args) => {
    bounded(args.scopeKey, 256);
    bounded(args.key, 512);
    bounded(args.termsJson, 8192);
    const existing = await ctx.db
      .query("usageCatalog")
      .withIndex("by_scope_kind_key", (q) =>
        q
          .eq("scopeKey", args.scopeKey)
          .eq("kind", args.kind)
          .eq("key", args.key),
      )
      .unique();
    if (existing) {
      if (existing.termsJson !== args.termsJson)
        throw new Error("Immutable usage catalog terms conflict");
      return existing;
    }
    const id = await ctx.db.insert("usageCatalog", {
      ...args,
      firstAttemptAt: Math.floor(Date.now() / 1000),
    });
    const result = await ctx.db.get("usageCatalog", id);
    if (!result) throw new Error("Usage catalog intent unavailable");
    return result;
  },
});
export const complete = mutation({
  args: {
    scopeKey: v.string(),
    kind,
    key: v.string(),
    providerId: v.string(),
    observationJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    bounded(args.providerId, 100);
    bounded(args.observationJson, 8192);
    const row = await ctx.db
      .query("usageCatalog")
      .withIndex("by_scope_kind_key", (q) =>
        q
          .eq("scopeKey", args.scopeKey)
          .eq("kind", args.kind)
          .eq("key", args.key),
      )
      .unique();
    if (!row || (row.providerId && row.providerId !== args.providerId))
      throw new Error("Usage catalog reassignment rejected");
    const existing = await ctx.db
      .query("usageCatalog")
      .withIndex("by_scope_kind_provider", (q) =>
        q
          .eq("scopeKey", args.scopeKey)
          .eq("kind", args.kind)
          .eq("providerId", args.providerId),
      )
      .unique();
    if (existing && existing._id !== row._id)
      throw new Error("Usage catalog ownership conflict");
    await ctx.db.patch("usageCatalog", row._id, {
      providerId: args.providerId,
      observationJson: args.observationJson,
    });
    return null;
  },
});
