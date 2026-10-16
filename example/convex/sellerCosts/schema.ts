import { defineTable } from "convex/server";
import { costBillFields, sellerCostFields } from "./validators";
export const sellerCostsTables = {
  sellerCosts: defineTable(sellerCostFields)
    .index("by_charge", ["sourceChargeId"])
    // History must sort all costs by creation time, independently of open status.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_seller", ["sellerId"])
    .index("by_seller_open", ["sellerId", "open"])
    .index("by_recovery_version", ["sellerId", "recoveryVersion"]),

  storeCostBills: defineTable(costBillFields).index("by_invoice", [
    "invoiceId",
  ]),
};
