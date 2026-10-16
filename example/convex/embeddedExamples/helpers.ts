import { v } from "convex/values";

export const kind = v.union(
  v.literal("account"),
  v.literal("onboarding"),
  v.literal("payments"),
  v.literal("refunds"),
  v.literal("disputes"),
  v.literal("balances"),
  v.literal("payouts"),
  v.literal("notifications"),
);
