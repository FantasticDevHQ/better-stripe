"use client";

import {
  ConnectDisputesList,
  ConnectPaymentDisputes,
} from "@stripe/react-connect-js";

export type EmbeddedDisputesProps = {
  /**
   * Mount the `payment_disputes` component scoped to one payment (a charge or
   * PaymentIntent id) instead of the seller-wide `disputes_list`.
   */
  payment?: string;
  /** CSS class for the wrapper div */
  className?: string;
};

/**
 * Embedded Stripe Connect dispute surface (BTS-55) — the Stripe-hosted
 * alternative to the headless DisputesList/DisputeDetail components. Mounts
 * the `disputes_list` embedded component (or `payment_disputes` when scoped
 * via `payment`), both enabled by the Account Session that
 * `createDisputeSession` (BTS-30) creates.
 *
 * Must be rendered inside a {@link ConnectProvider} whose `fetchClientSecret`
 * returns that session's `clientSecret`.
 */
export function EmbeddedDisputes({ payment, className }: EmbeddedDisputesProps) {
  return (
    <div className={className}>
      {payment ? (
        <ConnectPaymentDisputes payment={payment} />
      ) : (
        <ConnectDisputesList />
      )}
    </div>
  );
}
