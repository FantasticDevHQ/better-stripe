"use client";

import type { ReactNode } from "react";

export type TrialAlertProps = {
  isTrialing: boolean;
  daysRemaining: number;
  /** i18n overrides */
  trialLabel?: string;
  renewalLabel?: string;
  className?: string;
  children?: (props: {
    isTrialing: boolean;
    daysRemaining: number;
    message: string;
  }) => ReactNode;
};

/**
 * Headless trial/renewal alert.
 */
export function TrialAlert({
  isTrialing,
  daysRemaining,
  trialLabel = "Trial ends in {days} days",
  renewalLabel = "Renews in {days} days",
  className,
  children,
}: TrialAlertProps) {
  if (!isTrialing && daysRemaining <= 0) return null;

  const template = isTrialing ? trialLabel : renewalLabel;
  const message = template.replace("{days}", String(daysRemaining));

  if (children) {
    return <>{children({ isTrialing, daysRemaining, message })}</>;
  }

  return (
    <div className={className} role="alert">
      {message}
    </div>
  );
}
