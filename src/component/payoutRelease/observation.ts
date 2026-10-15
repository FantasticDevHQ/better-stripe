import { v } from "convex/values";
export const observation = v.object({
  stripeTransferId: v.string(),
  currency: v.string(),
  matureNet: v.number(),
  pendingCredits: v.number(),
  ledgerFingerprint: v.string(),
  observedAt: v.number(),
  transactionIds: v.array(v.string()),
});
