'use client';

import type { ReactNode } from 'react';

export type PaymentMethodItem = {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  isDefault: boolean;
};

export type PaymentMethodsListProps = {
  methods: PaymentMethodItem[];
  onDelete?: (id: string) => void;
  onSetDefault?: (id: string) => void;
  emptyLabel?: string;
  defaultBadgeLabel?: string;
  deleteLabel?: string;
  setDefaultLabel?: string;
  className?: string;
  children?: (props: {
    methods: PaymentMethodItem[];
    onDelete?: (id: string) => void;
    onSetDefault?: (id: string) => void;
  }) => ReactNode;
};

/**
 * Headless payment methods list.
 */
export function PaymentMethodsList({
  methods,
  onDelete,
  onSetDefault,
  emptyLabel = 'No payment methods on file.',
  defaultBadgeLabel = 'Default',
  deleteLabel = 'Remove',
  setDefaultLabel = 'Set as default',
  className,
  children,
}: PaymentMethodsListProps) {
  if (children) {
    return <>{children({ methods, onDelete, onSetDefault })}</>;
  }

  if (methods.length === 0) {
    return <p className={className}>{emptyLabel}</p>;
  }

  return (
    <ul className={className}>
      {methods.map((method) => (
        <li key={method.id}>
          <span>
            {method.card
              ? `${method.card.brand} ····${method.card.last4} (${method.card.expMonth}/${method.card.expYear})`
              : method.type}
          </span>
          {method.isDefault && <span>{defaultBadgeLabel}</span>}
          {!method.isDefault && onSetDefault && (
            <button type="button" onClick={() => onSetDefault(method.id)}>
              {setDefaultLabel}
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={() => onDelete(method.id)}>
              {deleteLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
