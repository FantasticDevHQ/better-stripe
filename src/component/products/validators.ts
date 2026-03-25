import { type Infer, v } from 'convex/values';

export const priceTypeValidator = v.union(
  v.literal('one_time'),
  v.literal('recurring'),
);
export type PriceType = Infer<typeof priceTypeValidator>;

export const priceIntervalValidator = v.optional(
  v.union(
    v.literal('day'),
    v.literal('week'),
    v.literal('month'),
    v.literal('year'),
  ),
);
