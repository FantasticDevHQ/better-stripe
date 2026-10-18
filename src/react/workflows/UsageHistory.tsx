"use client";
import type { ReactNode } from "react";
import type { UsageAvailability } from "../../client/usage/boundaries.js";
import { useWorkflowResource } from "./useWorkflowResource.js";
import { Pagination, useCursorPagination } from "./Pagination.js";
import { usageViewKey, type UsageViewScope } from "./Usage.types.js";
export type UsageHistoryPage<Row> = {
  records: readonly Row[];
  cursor: string | null;
  isDone: boolean;
  complete?: boolean;
};
export type UsageHistoryProps<Row> = {
  scope: UsageViewScope;
  /** Distinguish event, credit, allowance or delivery readers and their filters. */
  historyKey: string;
  load: (
    scope: UsageViewScope,
    page: { cursor: string | null; limit: number },
  ) => Promise<UsageAvailability<UsageHistoryPage<Row>>>;
  getKey: (record: Row) => string;
  renderRecord: (record: Row) => ReactNode;
  limit?: number;
  label?: string;
  className?: string;
  children?: (state: ReturnType<typeof useUsageHistory<Row>>) => ReactNode;
};
export function useUsageHistory<Row>(
  props: Pick<
    UsageHistoryProps<Row>,
    "scope" | "historyKey" | "load" | "limit"
  >,
) {
  const limit = props.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Usage history page size must be 1–100");
  const key = JSON.stringify([
    usageViewKey(props.scope),
    props.historyKey,
    limit,
  ]);
  const navigation = useCursorPagination(key);
  const resource = useWorkflowResource(
    async () => {
      try {
        const result = await props.load(props.scope, {
          cursor: navigation.cursor,
          limit,
        });
        if (
          result.status === "available" &&
          (result.value.records.length > limit ||
            (result.value.cursor !== null && result.value.cursor.length > 2048))
        )
          throw new Error("Invalid history page");
        return result;
      } catch {
        throw new Error("History unavailable. Try again.");
      }
    },
    JSON.stringify([key, navigation.cursor]),
  );
  const available =
    resource.data?.status === "available" ? resource.data.value : null;
  const advancing =
    !!available &&
    typeof available.cursor === "string" &&
    available.cursor.length > 0 &&
    !navigation.hasCursor(available.cursor);
  const incomplete =
    available?.complete === false ||
    (!!available && !available.isDone && !advancing);
  const canNext = !!available && !available.isDone && advancing;
  return {
    ...resource,
    page: navigation.page,
    canPrevious: navigation.canPrevious,
    canNext,
    isIncomplete: incomplete,
    isEmpty:
      !!available &&
      available.records.length === 0 &&
      available.isDone &&
      !incomplete,
    previous: () => {
      if (!resource.isLoading) navigation.previous();
    },
    next: () => {
      if (!resource.isLoading && canNext) navigation.next(available!.cursor!);
    },
  };
}
export function UsageHistory<Row>(props: UsageHistoryProps<Row>) {
  return (
    <UsageHistoryBody
      key={JSON.stringify([
        usageViewKey(props.scope),
        props.historyKey,
        props.limit ?? 25,
      ])}
      {...props}
    />
  );
}
function UsageHistoryBody<Row>(props: UsageHistoryProps<Row>) {
  const state = useUsageHistory(props);
  if (props.children) return <>{props.children(state)}</>;
  const available =
    state.data?.status === "available" ? state.data.value : null;
  return (
    <section
      data-better-stripe="usage-history"
      className={props.className}
      aria-label={props.label ?? "Usage history"}
      aria-busy={state.isLoading}
    >
      <h2>{props.label ?? "Usage history"}</h2>
      <button type="button" disabled={state.isLoading} onClick={state.refresh}>
        Refresh history
      </button>
      {state.isLoading && <p role="status">Loading history…</p>}
      {(state.isLoading || state.error) && available && (
        <p role="status">Displayed history may be stale.</p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {state.data && state.data.status !== "available" && (
        <p role="status">
          History {state.data.status}. Original scoped history is required.
        </p>
      )}
      {state.isIncomplete && (
        <p role="status">
          History incomplete. This page does not establish complete totals.
        </p>
      )}
      {state.isEmpty && <p>No history for this view.</p>}
      {available && (
        <ol>
          {available.records.map((record) => (
            <li key={props.getKey(record)}>{props.renderRecord(record)}</li>
          ))}
        </ol>
      )}
      <Pagination
        page={state.page}
        canPrevious={state.canPrevious}
        canNext={state.canNext}
        isLoading={state.isLoading}
        onPrevious={state.previous}
        onNext={state.next}
      />
    </section>
  );
}
