import { convexToJson, type JSONValue, type Value } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
export const transferProducerScope = JSON.stringify([
  "producer",
  "transfer_fact",
  1,
]);
function canonical(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
export function transferFingerprint(value: Value) {
  return generateIdempotencyKey("transfer-observation-v1", {
    value: canonical(convexToJson(value)),
  });
}
export function transferIdentity(row: Doc<"transfers">) {
  return {
    transferId: row._id,
    createdAt: row._creationTime,
    stripeTransferId: row.stripeTransferId,
    sourceChargeId: row.sourceChargeId,
    sourceInvoiceId: row.sourceInvoiceId,
    destinationAccountId: row.destinationAccountId,
    amount: row.amount,
    currency: row.currency,
    role: row.role,
    paymentId: row.paymentId,
    reinstatement: row.reinstatement,
  };
}
