import { v } from 'convex/values';

import { query } from './_generated/server';

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('users').collect();
  },
});

export const getByRole = query({
  args: {
    role: v.union(
      v.literal('learner'),
      v.literal('creator'),
      v.literal('admin'),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('role'), args.role))
      .first();
  },
});
