"use client";

import { type ReactNode, useState } from "react";

export type BillingPortalLinkProps = {
  /** URL to Stripe billing portal (from createBillingPortalSession) */
  portalUrl?: string | null;
  /** Called to create a billing portal session on demand */
  onCreateSession?: () => Promise<string | void>;
  /** Called when onCreateSession throws; failures are also logged to the console */
  onError?: (error: string) => void;
  label?: string;
  loadingLabel?: string;
  className?: string;
  children?: (props: {
    url: string | null;
    onClick: () => void;
    isLoading: boolean;
  }) => ReactNode;
};

/**
 * Headless billing portal link/button.
 * Opens Stripe's hosted billing portal for subscription management.
 */
export function BillingPortalLink({
  portalUrl,
  onCreateSession,
  onError,
  label = "Manage billing",
  loadingLabel = "Loading...",
  className,
  children,
}: BillingPortalLinkProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (portalUrl) {
      window.open(portalUrl, "_blank");
      return;
    }
    if (onCreateSession && !isLoading) {
      setIsLoading(true);
      try {
        const url = await onCreateSession();
        if (url) {
          window.open(url, "_blank");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to open billing portal";
        console.error("[better-stripe] BillingPortalLink:", err);
        onError?.(message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (children) {
    return (
      <>
        {children({
          url: portalUrl ?? null,
          onClick: handleClick,
          isLoading,
        })}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      disabled={isLoading}
    >
      {isLoading ? loadingLabel : label}
    </button>
  );
}
