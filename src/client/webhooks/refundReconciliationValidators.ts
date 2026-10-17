import { v, type Infer } from "convex/values";
import { refundDocValidator } from "../../component/connect/validators.js";

/** Component document IDs are opaque strings in the host's table namespace. */
export const refundReconciliationResult = v.object({
  status: v.literal("accepted"),
  apiContext: v.string(),
  generation: v.number(),
  changed: v.boolean(),
  refund: v.object({ ...refundDocValidator.fields, _id: v.string() }),
});

export type RefundReconciliationResult = Infer<
  typeof refundReconciliationResult
>;
