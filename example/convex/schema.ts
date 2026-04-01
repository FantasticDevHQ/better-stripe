import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("customer"),
      v.literal("seller"),
      v.literal("admin"),
    ),
    avatarUrl: v.optional(v.string()),
  }),
});
