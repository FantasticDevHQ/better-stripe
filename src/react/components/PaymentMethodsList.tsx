"use client";

import type { ReactNode } from "react";

import { PaymentMethodActions } from "./PaymentMethodActions.js";

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
  emptyLabel = "No payment methods on file.",
  defaultBadgeLabel = "Default",
  deleteLabel = "Remove",
  setDefaultLabel = "Set as default",
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
          <PaymentMethodActions
            methodId={method.id}
            isDefault={method.isDefault}
            onDelete={onDelete ? () => onDelete(method.id) : undefined}
            onSetDefault={
              onSetDefault ? () => onSetDefault(method.id) : undefined
            }
            deleteLabel={deleteLabel}
            setDefaultLabel={setDefaultLabel}
          />
        </li>
      ))}
    </ul>
  );
}
