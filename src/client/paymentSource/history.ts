import type Stripe from "stripe";

const incomplete = () => ({
  status: "unknown" as const,
  reason: "history_incomplete" as const,
  retryable: false as const,
});
/** Completeness is mandatory; previews, repeated cursors and exhausted budgets are not evidence of uniqueness. */
export async function completeHistory<T extends { id: string }>(
  fetch: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<Stripe.ApiList<T>>,
  maxPages: number,
  maxItems: number,
) {
  const data: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const limit = Math.min(100, maxItems - data.length);
    if (limit < 1) return incomplete();
    let page: Stripe.ApiList<T>;
    try {
      page = await fetch(cursor, limit);
    } catch {
      return incomplete();
    }
    if (
      !page ||
      page.object !== "list" ||
      !Array.isArray(page.data) ||
      page.data.length > limit ||
      typeof page.has_more !== "boolean" ||
      (page.has_more && !page.data.length)
    )
      return incomplete();
    for (const row of page.data) {
      if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id))
        return incomplete();
      seen.add(row.id);
      data.push(row);
    }
    if (!page.has_more) return { status: "complete" as const, data };
    cursor = data[data.length - 1]!.id;
  }
  return incomplete();
}
