"use client";

import { useQuery } from "convex/react";

export function useStripePublishableKey(
  queryRef: any,
): string | null | undefined {
  return useQuery(queryRef, {});
}
