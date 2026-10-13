"use client";
import type { Key, ReactNode } from "react";
export type WorkflowColumn<Row> = {
  id: string;
  label: string;
  align?: "start" | "end";
  cell: (row: Row) => ReactNode;
};
export type CollectionRenderProps<Row> = {
  rows: Row[];
  columns: WorkflowColumn<Row>[];
  getKey: (row: Row) => Key;
  isLoading: boolean;
  isEmpty: boolean;
  error: string | null;
  emptyLabel: string;
  loadingLabel: string;
};
export type CollectionProps<Row> = {
  rows: Row[] | null | undefined;
  columns: WorkflowColumn<Row>[];
  getKey: (row: Row) => Key;
  isLoading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  loadingLabel?: string;
  children?: (state: CollectionRenderProps<Row>) => ReactNode;
};
/** Accessible native table by default. Render props let the application supply its design-system elements. */
export function Collection<Row>({
  rows,
  columns,
  getKey,
  isLoading = rows === undefined,
  error = null,
  emptyLabel = "No records yet.",
  loadingLabel = "Loading…",
  children,
}: CollectionProps<Row>) {
  const state: CollectionRenderProps<Row> = {
    rows: rows ?? [],
    columns,
    getKey,
    isLoading,
    isEmpty: !isLoading && !rows?.length,
    error,
    emptyLabel,
    loadingLabel,
  };
  if (children) return <>{children(state)}</>;
  if (error) return <p role="alert">{error}</p>;
  if (isLoading) return <p role="status">{loadingLabel}</p>;
  if (state.isEmpty) return <p>{emptyLabel}</p>;
  return (
    <table data-better-stripe="collection">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.rows.map((row) => (
          <tr key={getKey(row)}>
            {columns.map((column) => (
              <td key={column.id}>{column.cell(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
