import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal('learner'),
      v.literal('creator'),
      v.literal('admin'),
    ),
    avatarUrl: v.optional(v.string()),
  }),

  // Simple course catalog
  courses: defineTable({
    title: v.string(),
    description: v.string(),
    creatorUserId: v.id('users'),
    imageUrl: v.optional(v.string()),
    published: v.boolean(),
  }).index('by_creator', ['creatorUserId']),

  // Course access grants (populated by subscription triggers)
  courseAccess: defineTable({
    userId: v.id('users'),
    courseId: v.id('courses'),
    grantedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_course', ['courseId']),

  // Webhook event log for admin viewer
  webhookLog: defineTable({
    eventType: v.string(),
    stripeEventId: v.string(),
    status: v.union(
      v.literal('processed'),
      v.literal('failed'),
      v.literal('ignored'),
    ),
    payload: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index('by_timestamp', ['timestamp'])
    .index('by_type', ['eventType']),
});
