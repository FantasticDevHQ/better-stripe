import type Stripe from "stripe";
import { completeHistory } from "../paymentSource/history.js";
export type ProcessingCostHistoryBounds = {
  maxPages: number;
  maxItems: number;
};
export class ProcessingCostHistoryIncomplete extends Error {
  constructor() {
    super("Processing-cost history is incomplete.");
  }
}
export async function boundedCostHistory<T extends { id: string }>(
  fetch: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<Stripe.ApiList<T>>,
  bounds: ProcessingCostHistoryBounds,
): Promise<T[]> {
  if (
    !Number.isSafeInteger(bounds.maxPages) ||
    bounds.maxPages < 1 ||
    bounds.maxPages > 20 ||
    !Number.isSafeInteger(bounds.maxItems) ||
    bounds.maxItems < 1 ||
    bounds.maxItems > 2000
  )
    throw new RangeError("Invalid processing-cost history bounds.");
  const result = await completeHistory(fetch, bounds.maxPages, bounds.maxItems);
  if (result.status !== "complete") throw new ProcessingCostHistoryIncomplete();
  return result.data;
}
