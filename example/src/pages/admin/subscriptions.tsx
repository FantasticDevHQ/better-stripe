import {
  Subscriptions,
  useSubscriptionFilter,
} from "@fantastic.dev/better-stripe/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "trialing":
      return "secondary";
    case "past_due":
      return "destructive";
    case "canceled":
      return "outline";
    default:
      return "outline";
  }
}

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString();
}

export function AdminSubscriptions() {
  const subscriptions = useQuery(api.billing.public.queries.listSubscriptions);
  const { filter, setFilter, filtered, countByStatus, tabs } =
    useSubscriptionFilter(subscriptions);

  if (subscriptions === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-96" />
        <Card>
          <div className="space-y-4 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Subscriptions</h1>

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              <span className="text-muted-foreground ml-1.5 text-xs">
                {tab.value === "all"
                  ? subscriptions.length
                  : countByStatus(tab.value)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Single content area for all tabs since we handle filtering ourselves */}
        <TabsContent value={filter} className="mt-6">
          <Card>
            <Subscriptions rows={filtered}>
              {({ rows, isEmpty }) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscription ID</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Current Period</TableHead>
                      <TableHead>Trial End</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((sub) => (
                      <TableRow key={sub._id}>
                        <TableCell>
                          <p className="font-mono text-sm">
                            {sub.stripeSubscriptionId}
                          </p>
                        </TableCell>
                        <TableCell tone="muted">{sub.userId}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(sub.status)}>
                            {sub.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell tone="muted">
                          {formatDate(sub.currentPeriodStart)} &rarr;{" "}
                          {formatDate(sub.currentPeriodEnd)}
                        </TableCell>
                        <TableCell tone="muted">
                          {sub.trialEnd ? formatDate(sub.trialEnd) : "\u2014"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {isEmpty && (
                      <TableRow>
                        <TableCell colSpan={5} size="empty">
                          <Alert>
                            <AlertDescription className="text-center">
                              No data found for the current subscription
                              filters.
                            </AlertDescription>
                          </Alert>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </Subscriptions>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
