import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

type WebhookStatus = "processed" | "failed" | "pending";

function statusVariant(
  status: WebhookStatus,
): "default" | "destructive" | "secondary" {
  switch (status) {
    case "processed":
      return "default";
    case "failed":
      return "destructive";
    case "pending":
      return "secondary";
  }
}

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString();
}

export function AdminWebhooks() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const events = useQuery(api.queries.listWebhookEvents, {
    eventType: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  if (events === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="flex gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-36" />
        </div>
        <Card>
          <div className="space-y-4 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // Gather unique event types from the data for the filter dropdown
  const eventTypes = [...new Set(events.map((e) => e.eventType))];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Webhook Event Log</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label>Event Type</Label>
          <Select
            value={typeFilter}
            onValueChange={(v: string | null) => v && setTypeFilter(v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All Events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onValueChange={(v: string | null) => v && setStatusFilter(v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Events Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Event Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Stripe Event ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <>
                <TableRow
                  key={event._id}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedEvent(
                      expandedEvent === event._id ? null : event._id,
                    )
                  }
                >
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {formatTimestamp(event.processedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {event.eventType}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(event.status)}>
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {event.stripeEventId}
                  </TableCell>
                </TableRow>

                {/* Expanded Details */}
                {expandedEvent === event._id && (
                  <TableRow key={`${event._id}-details`}>
                    <TableCell colSpan={4} className="bg-muted/30">
                      <div className="text-muted-foreground space-y-1 text-xs">
                        {event.lastError && (
                          <p>
                            <span className="font-medium">Error:</span>{" "}
                            {event.lastError}
                          </p>
                        )}
                        {event.livemode !== undefined && (
                          <p>
                            <span className="font-medium">Mode:</span>{" "}
                            {event.livemode ? "Live" : "Test"}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8">
                  <Alert>
                    <AlertDescription className="text-center">
                      No webhook events match the current filters.
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
