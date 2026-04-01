"use client";

import type { ReactNode } from "react";

import { AccountOnboardingButton } from "./AccountOnboardingButton.js";

export type AccountOnboardingCardRenderProps = {
  status: string | undefined;
  isComplete: boolean;
  progress: number;
  missingRequirements: string[];
  onContinue?: () => void;
  onReset?: () => void;
  dashboardUrl?: string;
  isLoading: boolean;
};

export type AccountOnboardingCardProps = {
  status: "pending" | "in_progress" | "complete" | "restricted" | undefined;
  missingRequirements?: string[];
  onContinue?: () => void;
  onReset?: () => void;
  /** Externally computed progress (0–100). If omitted, derived from status. */
  progress?: number;
  /** URL to open when onboarding is complete */
  dashboardUrl?: string;
  /** Whether an async action is in progress */
  isLoading?: boolean;
  titleLabel?: string;
  completeLabel?: string;
  continueLabel?: string;
  resetLabel?: string;
  className?: string;
  /** Render prop for a progress bar section */
  renderProgress?: (props: { progress: number }) => ReactNode;
  /** Render prop for step-by-step checklist */
  renderSteps?: (props: { status: string | undefined }) => ReactNode;
  /** Render prop for a status badge */
  renderStatusBadge?: () => ReactNode;
  /** Render prop for requirements section */
  renderRequirements?: () => ReactNode;
  /** Render prop for the reset confirmation UI (e.g. a modal trigger) */
  renderResetConfirmation?: (props: { onConfirm: () => void }) => ReactNode;
  /** Render prop for the dashboard link shown when onboarding is complete */
  renderDashboardLink?: (props: { url: string; label: string }) => ReactNode;
  /** Full render prop — overrides all default rendering */
  children?: (props: AccountOnboardingCardRenderProps) => ReactNode;
};

/**
 * Headless Connect account onboarding progress card.
 */
export function AccountOnboardingCard({
  status,
  missingRequirements = [],
  onContinue,
  onReset,
  progress: externalProgress,
  dashboardUrl,
  isLoading = false,
  titleLabel = "Account setup",
  completeLabel = "Your account is verified and ready.",
  continueLabel = "Continue setup",
  resetLabel = "Reset account",
  className,
  renderProgress,
  renderSteps,
  renderStatusBadge,
  renderRequirements,
  renderResetConfirmation,
  renderDashboardLink,
  children,
}: AccountOnboardingCardProps) {
  const isComplete = status === "complete";
  const progress =
    externalProgress ??
    (status === "complete"
      ? 100
      : status === "in_progress"
        ? 50
        : status === "restricted"
          ? 25
          : 0);

  if (children) {
    return (
      <>
        {children({
          status,
          isComplete,
          progress,
          missingRequirements,
          onContinue,
          onReset,
          dashboardUrl,
          isLoading,
        })}
      </>
    );
  }

  return (
    <div className={className}>
      <div>
        <h3>{titleLabel}</h3>
        {renderStatusBadge?.()}
      </div>
      {renderProgress?.({ progress })}
      {renderSteps?.({ status })}
      {isComplete ? (
        <>
          <p>{completeLabel}</p>
          {dashboardUrl &&
            (renderDashboardLink ? (
              renderDashboardLink({
                url: dashboardUrl,
                label: "Open dashboard",
              })
            ) : (
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                Open dashboard
              </a>
            ))}
        </>
      ) : (
        <>
          {missingRequirements.length > 0 && (
            <p>{missingRequirements.length} items remaining</p>
          )}
          {renderRequirements?.()}
          <div>
            {onReset &&
              (renderResetConfirmation ? (
                renderResetConfirmation({ onConfirm: onReset })
              ) : (
                <button type="button" onClick={onReset} disabled={isLoading}>
                  {resetLabel}
                </button>
              ))}
            {onContinue && (
              <AccountOnboardingButton
                onContinue={onContinue}
                isLoading={isLoading}
                continueLabel={continueLabel}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
