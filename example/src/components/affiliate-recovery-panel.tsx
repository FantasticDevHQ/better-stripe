import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { useQuery } from "convex/react";
import {
  Pagination,
  useCursorPagination,
  AffiliateRecovery,
  type AffiliateRecoveryProps,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function AffiliateRecoveryPanel({
  presentation = "components",
}: {
  presentation?: "components" | "headless";
}) {
  const pagination = useCursorPagination("affiliate-recovery:usd");
  const snapshot = useQuery(api.affiliateRecovery.snapshot, {
    currency: "usd",
    paginationOpts: { numItems: 20, cursor: pagination.cursor },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authenticated commission recovery</CardTitle>
      </CardHeader>
      <CardContent>
        {snapshot && snapshot.obligations.page.length === 0 ? (
          <EmptyState>
            No commission adjustments. Recovery will appear after an attributed
            sale.
          </EmptyState>
        ) : (
          <RecoveryPresentation
            snapshot={snapshot}
            currency="usd"
            presentation={presentation}
          />
        )}
        {snapshot && (
          <Pagination
            page={pagination.page}
            canPrevious={pagination.canPrevious}
            canNext={!snapshot.obligations.isDone}
            onPrevious={pagination.previous}
            onNext={() => pagination.next(snapshot.obligations.continueCursor)}
          />
        )}
      </CardContent>
    </Card>
  );
}
export function RecoveryPresentation({
  presentation,
  ...props
}: AffiliateRecoveryProps & { presentation: "components" | "headless" }) {
  if (presentation === "components")
    return (
      <AffiliateRecovery
        {...props}
        className="space-y-4 [&_table]:w-full [&_caption]:text-left [&_th]:text-left [&_th]:p-3 [&_td]:p-3 [&_dl]:grid [&_dl]:gap-4 [&_dl]:sm:grid-cols-3"
      />
    );
  return (
    <AffiliateRecovery {...props}>
      {(state) => (
        <>
          {props.snapshot === null ? (
            <p>Sign in to view your commission recovery.</p>
          ) : state.isLoading ? (
            <p role="status">Loading commission recovery…</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.metrics.map((metric) => (
                  <Card key={metric.key}>
                    <CardHeader>
                      <CardTitle variant="metric">{metric.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-semibold tabular-nums">
                        {metric.formattedValue}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Original sale</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead>Recovered</TableHead>
                    <TableHead>Debt</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.adjustments.map((item) => (
                    <TableRow key={item.row._id}>
                      <TableCell variant="identifier">{item.source}</TableCell>
                      <TableCell variant="amount">{item.commission}</TableCell>
                      <TableCell variant="amount">{item.recovered}</TableCell>
                      <TableCell variant="amount">{item.debt}</TableCell>
                      <TableCell>{item.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </>
      )}
    </AffiliateRecovery>
  );
}
