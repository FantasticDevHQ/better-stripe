"use client";
import { useState } from "react";
export function webhookQueryArgs(eventType: string, status: string) {
  return {
    eventType: eventType === "all" ? undefined : eventType,
    status: status === "all" ? undefined : status,
  };
}
export function useWebhookFilters() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  return {
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    expandedEvent,
    setExpandedEvent,
    queryArgs: webhookQueryArgs(typeFilter, statusFilter),
  };
}
