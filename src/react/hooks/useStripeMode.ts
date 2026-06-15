"use client";

import { useQuery } from "convex/react";

import type { StripeMode } from "../../client/utils/stripeDashboardUrl.js";

export function useStripeMode(queryRef: any): StripeMode | undefined {
  return useQuery(queryRef, {});
}
