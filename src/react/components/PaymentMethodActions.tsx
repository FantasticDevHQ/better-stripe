"use client";

import type { ReactNode } from "react";

export type PaymentMethodActionsRenderProps = {
  methodId: string;
  isDefault: boolean;
  onDelete?: () => void;
  onSetDefault?: () => void;
  deleteLabel: string;
  setDefaultLabel: string;
};

export type PaymentMethodActionsProps = {
  methodId: string;
  isDefault?: boolean;
  onDelete?: () => void;
  onSetDefault?: () => void;
  deleteLabel?: string;
  setDefaultLabel?: string;
  className?: string;
  children?: (props: PaymentMethodActionsRenderProps) => ReactNode;
};

/**
 * Headless payment method action buttons (set default / delete).
 *
 * Shows "Set as default" button if not default + onSetDefault provided.
 * Shows delete button if onDelete provided.
 */
export function PaymentMethodActions({
  methodId,
  isDefault = false,
  onDelete,
  onSetDefault,
  deleteLabel = "Remove",
  setDefaultLabel = "Set as default",
  className,
  children,
}: PaymentMethodActionsProps) {
  const renderProps: PaymentMethodActionsRenderProps = {
    methodId,
    isDefault,
    onDelete,
    onSetDefault,
    deleteLabel,
    setDefaultLabel,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <span className={className}>
      {!isDefault && onSetDefault && (
        <button type="button" onClick={onSetDefault}>
          {setDefaultLabel}
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete}>
          {deleteLabel}
        </button>
      )}
    </span>
  );
}
