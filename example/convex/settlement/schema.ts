import { defineTable } from "convex/server";
import { storeSaleRecordFields } from "../storePlans/validators";
export const settlementTables = {
  storeSales: defineTable(storeSaleRecordFields)
    .index("by_charge", ["chargeId"])
    // Sales history must remain chronological across currencies and recovery states.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_seller", ["sellerId"])
    .index("by_recovery", [
      "sellerId",
      "currency",
      "status",
      "costRecoveryAmount",
    ]),
};
