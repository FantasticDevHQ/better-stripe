import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { kind, doc } from "./schema.js";
export const get = query({
  args: { scopeKey: v.string(), kind, key: v.string() },
  returns: v.union(doc, v.null()),
  handler: async (ctx, args) =>
    ctx.db
      .query("usageCatalog")
      .withIndex("by_scope_kind_key", (q) =>
        q
          .eq("scopeKey", args.scopeKey)
          .eq("kind", args.kind)
          .eq("key", args.key),
      )
      .unique(),
});
