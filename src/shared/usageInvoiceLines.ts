import { v } from "convex/values";
import type { Infer } from "convex/values";
/** Complete, canonical native invoice provenance retained with the charge allocation. */
export const usageInvoiceLineProof = v.object({
  lineId: v.string(),
  stripePriceId: v.string(),
  stripeProductId: v.string(),
  subscriptionItemId: v.string(),
  period: v.object({ start: v.number(), end: v.number() }),
  amount: v.number(),
  quantity: v.string(),
  kind: v.union(v.literal("fixed"), v.literal("metered")),
});
export type UsageInvoiceLineProof = Infer<typeof usageInvoiceLineProof>;
