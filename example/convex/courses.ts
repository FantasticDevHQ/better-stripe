import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery, query } from './_generated/server';

// Public queries
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('courses')
      .filter((q) => q.eq(q.field('published'), true))
      .collect();
  },
});

export const getByCreator = query({
  args: { creatorUserId: v.id('users') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('courses')
      .withIndex('by_creator', (q) => q.eq('creatorUserId', args.creatorUserId))
      .collect();
  },
});

export const getAccessForUser = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const access = await ctx.db
      .query('courseAccess')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect();
    const courseIds = access.map((a) => a.courseId);
    const courses = await Promise.all(courseIds.map((id) => ctx.db.get(id)));
    return courses.filter(Boolean);
  },
});

// Internal queries/mutations (used by triggers)
export const listPublished = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('courses')
      .filter((q) => q.eq(q.field('published'), true))
      .collect();
  },
});

export const grantAccess = internalMutation({
  args: { userId: v.string(), courseId: v.id('courses') },
  handler: async (ctx, args) => {
    // Check if access already exists
    const existing = await ctx.db
      .query('courseAccess')
      .withIndex('by_user', (q) => q.eq('userId', args.userId as Id<'users'>))
      .filter((q) => q.eq(q.field('courseId'), args.courseId))
      .first();
    if (existing) return;

    await ctx.db.insert('courseAccess', {
      userId: args.userId as Id<'users'>,
      courseId: args.courseId,
      grantedAt: Date.now(),
    });
  },
});

export const revokeAllAccess = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const access = await ctx.db
      .query('courseAccess')
      .withIndex('by_user', (q) => q.eq('userId', args.userId as Id<'users'>))
      .collect();
    for (const record of access) {
      await ctx.db.delete(record._id);
    }
  },
});
