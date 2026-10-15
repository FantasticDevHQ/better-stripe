import { v } from "convex/values";
import { obligationFields } from "../../component/settlement/clawbackSchema.js";
import {
  balanceFields,
  operationFields,
} from "../../component/affiliateRecovery/schema.js";
export const affiliateObligationValidator = v.object({
  ...obligationFields,
  _id: v.string(),
  _creationTime: v.number(),
  earningId: v.optional(v.string()),
  activeOperationId: v.optional(v.string()),
});
export const affiliateOperationValidator = v.object({
  ...operationFields,
  _id: v.string(),
  _creationTime: v.number(),
  obligationId: v.string(),
});
export const affiliateSnapshotValidator = v.object({
  balance: v.union(
    v.object({ ...balanceFields, _id: v.string(), _creationTime: v.number() }),
    v.null(),
  ),
  obligations: v.object({
    page: v.array(affiliateObligationValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
});
