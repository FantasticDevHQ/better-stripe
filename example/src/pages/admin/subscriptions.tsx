import { useState } from "react";

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

const tabs = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Trialing", value: "trialing" },
  { label: "Past Due", value: "past_due" },
  { label: "Canceled", value: "canceled" },
] as const;

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
  const subscriptions = useQuery(api.queries.listSubscriptions);
  const [filter, setFilter] = useState<string>("all");

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

  const filtered =
    filter === "all"
      ? subscriptions
      : subscriptions.filter((s) => s.status === filter);

  const countByStatus = (status: string) =>
    subscriptions.filter((s) => s.status === status).length;

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
                {filtered.map((sub) => (
                  <TableRow key={sub._id}>
                    <TableCell>
                      <p className="font-mono text-sm">
                        {sub.stripeSubscriptionId}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {sub.userId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(sub.status)}>
                        {sub.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(sub.currentPeriodStart)} &rarr;{" "}
                      {formatDate(sub.currentPeriodEnd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {sub.trialEnd ? formatDate(sub.trialEnd) : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8">
                      <Alert>
                        <AlertDescription className="text-center">
                          No subscriptions found.
                        </AlertDescription>
                      </Alert>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
