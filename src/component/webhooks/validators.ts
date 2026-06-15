import { type Infer, v } from "convex/values";

export const webhookEventStatusValidator = v.union(
  v.literal("processing"),
  v.literal("processed"),
  v.literal("failed"),
  v.literal("ignored"),
);
export type WebhookEventStatus = Infer<typeof webhookEventStatusValidator>;

/**
 * Field validators for the `webhookEvents` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const webhookEventFields = {
  stripeEventId: v.string(),
  eventType: v.string(),
  livemode: v.optional(v.boolean()),
  processedAt: v.number(),
  status: webhookEventStatusValidator,
  lastError: v.optional(v.string()),
};

/** Full `webhookEvents` document, including system fields. */
export const webhookEventDocValidator = v.object({
  _id: v.id("webhookEvents"),
  _creationTime: v.number(),
  ...webhookEventFields,
});
