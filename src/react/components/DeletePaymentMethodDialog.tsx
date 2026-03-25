'use client';

import type { ReactNode } from 'react';

export type DeletePaymentMethodDialogProps = {
  isOpen: boolean;
  methodId: string | null;
  methodLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  titleLabel?: string;
  messageLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  className?: string;
  children?: (props: {
    isOpen: boolean;
    methodLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => ReactNode;
};

/**
 * Headless delete payment method confirmation.
 * Apps should wrap this with their own dialog/modal component.
 */
export function DeletePaymentMethodDialog({
  isOpen,
  methodId,
  methodLabel = 'this payment method',
  onConfirm,
  onCancel,
  titleLabel = 'Remove payment method',
  messageLabel = 'Are you sure you want to remove {method}?',
  confirmLabel = 'Remove',
  cancelLabel = 'Cancel',
  className,
  children,
}: DeletePaymentMethodDialogProps) {
  if (!isOpen) return null;

  const message = messageLabel.replace('{method}', methodLabel);

  if (children) {
    return <>{children({ isOpen, methodLabel, onConfirm, onCancel })}</>;
  }

  return (
    <div className={className} role="alertdialog" aria-modal="true">
      <h2>{titleLabel}</h2>
      <p>{message}</p>
      <button type="button" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  );
}
