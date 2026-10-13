import type { ReactNode } from "react";
import type {
  CollectionRenderProps,
  WorkflowColumn,
} from "@fantastic.dev/better-stripe/react";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
/** Maps package-owned rows, labels, formatting, and states to this app's design system. */
export function WorkflowTable<Row>({
  rows,
  columns,
  getKey,
  isLoading,
  isEmpty,
  error,
  emptyLabel,
  loadingLabel,
  renderCell,
}: CollectionRenderProps<Row> & {
  renderCell?: (
    row: Row,
    column: WorkflowColumn<Row>,
    content: ReactNode,
  ) => ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.id}
              className={column.align === "end" ? "text-right" : undefined}
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={getKey(row)}>
            {columns.map((column) => (
              <TableCell
                key={column.id}
                className={column.align === "end" ? "text-right" : undefined}
              >
                {renderCell
                  ? renderCell(row, column, column.cell(row))
                  : column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {error ? (
          <TableRow>
            <TableCell colSpan={columns.length}>
              <p role="alert">{error}</p>
            </TableCell>
          </TableRow>
        ) : isLoading ? (
          <TableRow>
            <TableCell colSpan={columns.length}>
              <p role="status">{loadingLabel}</p>
            </TableCell>
          </TableRow>
        ) : (
          isEmpty && (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <EmptyState>{emptyLabel}</EmptyState>
              </TableCell>
            </TableRow>
          )
        )}
      </TableBody>
    </Table>
  );
}
