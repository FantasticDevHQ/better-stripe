import { v } from "convex/values";
export const runFields = {
  key: v.literal("component-cutover"),
  state: v.union(
    v.literal("running"),
    v.literal("held"),
    v.literal("verified"),
  ),
  cursor: v.union(v.string(), v.null()),
  scanned: v.number(),
  active: v.number(),
  held: v.number(),
  page: v.optional(
    v.object({
      ids: v.array(v.id("storeBalanceFunding")),
      next: v.string(),
      done: v.boolean(),
    }),
  ),
};
export const runDoc = v.object({
  _id: v.id("storeBalanceMigrationRuns"),
  _creationTime: v.number(),
  ...runFields,
});
