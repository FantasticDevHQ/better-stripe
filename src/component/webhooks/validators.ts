import { type Infer, v } from 'convex/values';

export const webhookEventStatusValidator = v.union(
  v.literal('processing'),
  v.literal('processed'),
  v.literal('failed'),
  v.literal('ignored'),
);
export type WebhookEventStatus = Infer<typeof webhookEventStatusValidator>;
