'use client';

import type { ReactNode } from 'react';

import { getRequirementLabel } from '../lib/connect-requirement-keys.js';

export type StructuredRequirements = {
  currentlyDue?: string[];
  eventuallyDue?: string[];
  pendingVerification?: string[];
  disabledReason?: string;
  currentDeadline?: number;
};

export type EnrichedRequirement = { field: string; label: string };

export type ConnectRequirementsRenderProps = {
  /** Flat enriched list (from `requirements` prop) */
  requirements: EnrichedRequirement[];
  /** Structured categories (from `structuredRequirements` prop, if provided) */
  structured?: {
    currentlyDue: EnrichedRequirement[];
    eventuallyDue: EnrichedRequirement[];
    pendingVerification: EnrichedRequirement[];
    disabledReason?: string;
    currentDeadline?: number;
  };
};

export type ConnectRequirementsProps = {
  /** Flat list of requirement field names */
  requirements: string[];
  /** Override labels for specific requirement fields */
  labelOverrides?: Record<string, string>;
  /** Structured requirements with categories — used for richer rendering */
  structuredRequirements?: StructuredRequirements;
  titleLabel?: string;
  emptyLabel?: string;
  className?: string;
  /** Render prop for individual requirement categories */
  renderCategory?: (props: {
    category: 'currentlyDue' | 'eventuallyDue' | 'pendingVerification';
    items: EnrichedRequirement[];
    deadline?: number;
  }) => ReactNode;
  /** Render prop for the disabled reason section */
  renderDisabledReason?: (props: { reason: string }) => ReactNode;
  /** Custom deadline formatter */
  formatDeadline?: (timestamp: number) => string;
  /** Full render prop — overrides all default rendering */
  children?: (props: ConnectRequirementsRenderProps) => ReactNode;
};

function enrichFields(
  fields: string[],
  overrides?: Record<string, string>,
): EnrichedRequirement[] {
  return fields.map((field) => ({
    field,
    label: getRequirementLabel(field, overrides),
  }));
}

/**
 * Headless Connect requirements checklist.
 * Shows missing Stripe verification requirements with i18n support.
 */
export function ConnectRequirements({
  requirements,
  labelOverrides,
  structuredRequirements,
  titleLabel = 'Missing requirements',
  emptyLabel = 'All requirements met.',
  className,
  renderCategory,
  renderDisabledReason,
  formatDeadline: _formatDeadline,
  children,
}: ConnectRequirementsProps) {
  const enrichedRequirements = enrichFields(requirements, labelOverrides);

  const structured = structuredRequirements
    ? {
        currentlyDue: enrichFields(
          structuredRequirements.currentlyDue ?? [],
          labelOverrides,
        ),
        eventuallyDue: enrichFields(
          structuredRequirements.eventuallyDue ?? [],
          labelOverrides,
        ),
        pendingVerification: enrichFields(
          structuredRequirements.pendingVerification ?? [],
          labelOverrides,
        ),
        disabledReason: structuredRequirements.disabledReason,
        currentDeadline: structuredRequirements.currentDeadline,
      }
    : undefined;

  if (children) {
    return <>{children({ requirements: enrichedRequirements, structured })}</>;
  }

  // If structured requirements provided and renderCategory is available, use category rendering
  if (structured && renderCategory) {
    const hasAny =
      structured.currentlyDue.length > 0 ||
      structured.eventuallyDue.length > 0 ||
      structured.pendingVerification.length > 0;

    if (!hasAny) {
      return <p className={className}>{emptyLabel}</p>;
    }

    return (
      <div className={className}>
        {structured.currentlyDue.length > 0 &&
          renderCategory({
            category: 'currentlyDue',
            items: structured.currentlyDue,
            deadline: structured.currentDeadline,
          })}
        {structured.pendingVerification.length > 0 &&
          renderCategory({
            category: 'pendingVerification',
            items: structured.pendingVerification,
          })}
        {structured.eventuallyDue.length > 0 &&
          renderCategory({
            category: 'eventuallyDue',
            items: structured.eventuallyDue,
          })}
        {structured.disabledReason &&
          (renderDisabledReason ? (
            renderDisabledReason({ reason: structured.disabledReason })
          ) : (
            <p>{structured.disabledReason}</p>
          ))}
      </div>
    );
  }

  // Default flat rendering
  if (requirements.length === 0) {
    return <p className={className}>{emptyLabel}</p>;
  }

  return (
    <div className={className}>
      <h4>{titleLabel}</h4>
      <ul>
        {enrichedRequirements.map((req) => (
          <li key={req.field}>{req.label}</li>
        ))}
      </ul>
    </div>
  );
}
