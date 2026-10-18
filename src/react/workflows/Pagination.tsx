"use client";
import { useState, type ReactNode } from "react";

/** Cursor history for bounded server pages. Changing scope resets navigation. */
export function useCursorPagination(scopeKey: string) {
  const initial = { scopeKey, cursors: [null] as (string | null)[], index: 0 };
  const [state, setState] = useState(initial);
  const current = state.scopeKey === scopeKey ? state : initial;
  if (state.scopeKey !== scopeKey) setState(initial);
  return {
    cursor: current.cursors[current.index],
    page: current.index + 1,
    canPrevious: current.index > 0,
    hasCursor: (cursor: string) =>
      current.cursors.slice(0, current.index + 1).includes(cursor),
    previous: () =>
      setState((previous) => ({
        ...previous,
        index: Math.max(0, previous.index - 1),
      })),
    next: (cursor: string) =>
      setState((previous) => ({
        ...previous,
        cursors: [...previous.cursors.slice(0, previous.index + 1), cursor],
        index: previous.index + 1,
      })),
  };
}
export type PaginationProps = {
  page: number;
  canPrevious: boolean;
  canNext: boolean;
  isLoading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
  pageLabel?: string;
  children?: (state: {
    pageLabel: string;
    previousLabel: string;
    nextLabel: string;
    previousDisabled: boolean;
    nextDisabled: boolean;
    previous: () => void;
    next: () => void;
  }) => ReactNode;
};
/** Unstyled navigation with render props for application design systems. */
export function Pagination({
  page,
  canPrevious,
  canNext,
  isLoading = false,
  onPrevious,
  onNext,
  previousLabel = "Previous",
  nextLabel = "Next",
  pageLabel = `Page ${page}`,
  children,
}: PaginationProps) {
  const previousDisabled = isLoading || !canPrevious;
  const nextDisabled = isLoading || !canNext;
  const state = {
    pageLabel,
    previousLabel,
    nextLabel,
    previousDisabled,
    nextDisabled,
    previous: () => {
      if (!previousDisabled) onPrevious();
    },
    next: () => {
      if (!nextDisabled) onNext();
    },
  };
  if (children) return <>{children(state)}</>;
  return (
    <nav aria-label="Pagination">
      <button
        type="button"
        disabled={previousDisabled}
        onClick={state.previous}
      >
        {previousLabel}
      </button>
      <span role="status" aria-live="polite">
        {pageLabel}
      </span>
      <button type="button" disabled={nextDisabled} onClick={state.next}>
        {nextLabel}
      </button>
    </nav>
  );
}
