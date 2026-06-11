"use client";

import type { StripeMode } from "../../client/utils/stripeDashboardUrl.js";
import { useStripePublishableKey } from "./useStripePublishableKey.js";

export type StripeConfig = {
  publishableKey: string | null | undefined;
  stripeMode: StripeMode | undefined;
  isLoading: boolean;
  error: string | null;
};

/**
 * Combined hook that returns the Stripe publishable key and loading/error state.
 *
 * @param publishableKeyQuery - Convex query ref that returns the publishable key
 */
export function useStripeConfig(publishableKeyQuery: any): StripeConfig {
  const publishableKey = useStripePublishableKey(publishableKeyQuery);
  const isLoading = publishableKey === undefined;
  const error =
    publishableKey === null
      ? "Stripe configuration error. Publishable key is missing."
      : null;
  const stripeMode: StripeMode | undefined = publishableKey
    ? publishableKey.startsWith("pk_live_")
      ? "live"
      : "test"
    : undefined;
  return { publishableKey, stripeMode, isLoading, error };
}
