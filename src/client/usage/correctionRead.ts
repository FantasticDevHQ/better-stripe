import type { PreparedUsageRecord } from "./records.js";
import type { UsageSubscriptionBinding } from "./boundaries.js";
import { subscriptionSnapshot } from "../../component/usage/helpers.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import { validateUsagePageRequest, type UsagePeriod } from "./boundaries.js";
import { scopeSchema, type UsageScope } from "./records.js";
import { z } from "zod";
export type UsageCorrectionHistoryRecord = Doc<"usageCorrectionHistory"> & {
  record: PreparedUsageRecord;
  subscription: UsageSubscriptionBinding;
  evidence: unknown;
  recordedAt: number;
};
export type UsageCorrectionHistoryPage = {
  records: UsageCorrectionHistoryRecord[];
  cursor: string | null;
  isDone: boolean;
  coverage: "recorded" | "not_recorded";
  legacyHistoryMissing: boolean;
};
export async function readCorrectionEvidence(
  component: Component,
  ctx: RunCtx,
  input: {
    scope: UsageScope;
    eventId?: string;
    period?: UsagePeriod;
    limit: number;
    cursor: string | null;
  },
): Promise<UsageCorrectionHistoryPage> {
  const page = validateUsagePageRequest({
    period: input.period ?? { start: 0, end: 1 },
    limit: input.limit,
    cursor: input.cursor,
  });
  const scope = scopeSchema.parse(input.scope);
  const result = (await ctx.runQuery(
    componentRef(
      component,
      input.eventId
        ? "usageCorrections/queries/readHistory"
        : "usageCorrections/queries/periodHistory",
    ),
    {
      scope,
      ...(input.eventId
        ? { eventId: z.string().min(1).max(100).parse(input.eventId) }
        : { period: page.period }),
      paginationOpts: { numItems: page.limit, cursor: page.cursor },
    },
  )) as {
    page: Doc<"usageCorrectionHistory">[];
    continueCursor: string;
    isDone: boolean;
    legacyHistoryMissing?: boolean;
  };
  return {
    records: result.page.map((row) => ({
      ...row,
      record: JSON.parse(row.recordJson) as PreparedUsageRecord,
      subscription: subscriptionSnapshot(row.subscriptionJson),
      evidence: JSON.parse(row.evidenceJson) as unknown,
      recordedAt: row.at,
    })),
    cursor: result.isDone ? null : result.continueCursor,
    isDone: result.isDone,
    coverage: result.page.length ? "recorded" : "not_recorded",
    legacyHistoryMissing: result.legacyHistoryMissing ?? false,
  };
}
