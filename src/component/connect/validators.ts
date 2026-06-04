import { type Infer, v } from "convex/values";

export const paymentStatusValidator = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("processing"),
  v.literal("requires_action"),
);
export type PaymentStatus = Infer<typeof paymentStatusValidator>;

export const payoutStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("in_transit"),
);
export type PayoutStatus = Infer<typeof payoutStatusValidator>;
