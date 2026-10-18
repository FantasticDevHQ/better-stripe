import { z } from "zod";
import { scopeSchema } from "../../client/usage/records.js";
import type { UsageScope } from "../../client/usage/records.js";
export function scopeKey(input: UsageScope) {
  const key = JSON.stringify(scopeSchema.parse(input));
  if (key.length > 512) throw new Error("Usage scope exceeds size limit");
  return key;
}
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const subscriptionSchema = z.strictObject({
  subscriptionId: z
    .string()
    .regex(/^sub_[a-zA-Z0-9]+$/)
    .max(100),
  subscriptionItemId: z
    .string()
    .regex(/^si_[a-zA-Z0-9]+$/)
    .max(100),
  stripePriceId: z
    .string()
    .regex(/^price_[a-zA-Z0-9]+$/)
    .max(100),
  period: z.strictObject({ start: seconds, end: seconds }),
  interval: z.literal("month"),
});
export function subscriptionSnapshot(json: string) {
  if (new TextEncoder().encode(json).length > 2048)
    throw new Error("Usage subscription exceeds size limit");
  const subscription = subscriptionSchema.parse(JSON.parse(json));
  if (subscription.period.end <= subscription.period.start)
    throw new Error("Invalid usage subscription period");
  return subscription;
}
